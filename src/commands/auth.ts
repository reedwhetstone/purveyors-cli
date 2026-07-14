import { Command } from 'commander';
import { createHash, randomBytes } from 'crypto';
import { hostname } from 'os';
import { spawn } from 'child_process';
import { createParchmentClient, type ParchmentClient } from '@purveyors/sdk';
import chalk from 'chalk';
import ora from 'ora';
import { validateSession } from '../lib/auth-client.js';
import { writeCredentials, deleteCredentials } from '../lib/config.js';
import { getParchmentBaseUrl } from '../lib/parchment-base.js';
import { outputData, shouldUseInteractiveOutput, success, info, warn } from '../lib/output.js';
import { withErrorHandling, AuthError, exitCodeForError } from '../lib/errors.js';
import type { OutputOptions, StoredCredentials } from '../types/index.js';

const DEFAULT_POLL_INTERVAL_SECONDS = 5;

type CliAuthClient = Pick<ParchmentClient, 'cliAuth'>;

interface DeviceLoginOptions {
  headless: boolean;
  client?: CliAuthClient;
  machineName?: string;
  openBrowser?: (url: string) => Promise<boolean>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
}

interface ApiErrorEnvelope {
  error?: ApiErrorBody;
}

/** Generate an RFC 7636 verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function apiError(result: { error?: unknown }): ApiErrorBody {
  if (!result.error || typeof result.error !== 'object') return {};
  const envelope = result.error as ApiErrorEnvelope;
  if (envelope.error && typeof envelope.error === 'object') return envelope.error;
  // Be tolerant of hand-written/mock clients that return the inner body directly.
  return result.error as ApiErrorBody;
}

/** Normalize hostnames to Parchment's stable, human-readable machine-name contract. */
export function normalizeMachineName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .trim()
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown-machine';
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AuthError('Login cancelled.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AuthError('Login cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Open the verification page, returning false when no browser command is available. */
export async function openVerificationPage(url: string): Promise<boolean> {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
      child.once('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

function toStoredCredentials(data: {
  apiKey: string;
  key: { id: string; createdAt: string | null };
  user: { id: string; email: string; role: string };
}): StoredCredentials {
  return {
    apiKey: data.apiKey,
    keyId: data.key.id,
    createdAt: data.key.createdAt ?? new Date().toISOString(),
    user: data.user,
  };
}

/**
 * Run the Parchment-owned browser/device authorization protocol.
 * The verifier and signed request token remain memory-only and are discarded on exit.
 */
export async function performDeviceLogin(options: DeviceLoginOptions): Promise<StoredCredentials> {
  if (options.signal?.aborted) throw new AuthError('Login cancelled.');
  const client = options.client ?? createParchmentClient({ baseUrl: getParchmentBaseUrl() });
  const { verifier, challenge } = createPkcePair();

  let created: Awaited<ReturnType<CliAuthClient['cliAuth']['create']>>;
  try {
    created = await client.cliAuth.create({
      machineName: normalizeMachineName(options.machineName ?? hostname()),
      codeChallenge: challenge,
    });
  } catch (error) {
    throw new AuthError('Could not contact Parchment to start login.', error);
  }
  if (!created.response.ok || created.error || !created.data) {
    const detail = apiError(created).message;
    throw new AuthError(detail ?? 'Parchment could not start the login request.', created.error);
  }

  const { requestToken, verificationUri, expiresAt } = created.data;
  const intervalSeconds = Math.max(
    1,
    Number.isFinite(created.data.intervalSeconds)
      ? created.data.intervalSeconds
      : DEFAULT_POLL_INTERVAL_SECONDS
  );

  if (options.headless) {
    console.log(chalk.bold('\n  Headless Login\n'));
    console.log('  Open this URL in a browser and approve access:\n');
    console.log(`  ${chalk.cyan(verificationUri)}\n`);
  } else {
    console.log(chalk.bold('\n  Opening Purveyors in your browser...'));
    const opened = await (options.openBrowser ?? openVerificationPage)(verificationUri);
    if (!opened) {
      warn('Could not open a browser. Open this URL to continue:');
      console.log(`  ${chalk.cyan(verificationUri)}\n`);
    } else {
      console.log(chalk.dim(`  If the browser did not open, visit:\n  ${verificationUri}\n`));
    }
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new AuthError('Parchment returned an invalid login expiration time.');
  }

  const sleep = options.sleep ?? wait;
  while (true) {
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      throw new AuthError('Login request expired. Run `purvey auth login` to try again.');
    }
    await sleep(Math.min(intervalSeconds * 1000, remainingMs), options.signal);
    if (Date.now() >= expiresAtMs) {
      throw new AuthError('Login request expired. Run `purvey auth login` to try again.');
    }

    let exchanged: Awaited<ReturnType<CliAuthClient['cliAuth']['exchange']>>;
    try {
      exchanged = await client.cliAuth.exchange({
        requestToken,
        codeVerifier: verifier,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new AuthError('Login cancelled.');
      throw new AuthError('Could not contact Parchment while waiting for approval.', error);
    }

    if (exchanged.response.ok && !exchanged.error && exchanged.data) {
      return toStoredCredentials(exchanged.data);
    }
    if (options.signal?.aborted) throw new AuthError('Login cancelled.');

    const error = apiError(exchanged);
    if (error.code === 'authorization_pending') continue;
    if (error.code === 'request_expired') {
      throw new AuthError('Login request expired. Run `purvey auth login` to try again.');
    }
    if (error.code === 'request_consumed') {
      throw new AuthError('Login request was already used. Run `purvey auth login` to try again.');
    }
    if (error.code === 'invalid_request' || error.code === 'request_conflict') {
      throw new AuthError(error.message ?? 'Parchment rejected the login request.');
    }
    throw new AuthError(error.message ?? 'Parchment could not complete login.', exchanged.error);
  }
}

async function login(headless: boolean): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  const spinner = ora({ text: 'Waiting for browser approval...', stream: process.stderr });

  try {
    const credentialsPromise = performDeviceLogin({ headless, signal: controller.signal });
    spinner.start();
    const credentials = await credentialsPromise;
    await writeCredentials(credentials);
    spinner.succeed(`Logged in as ${chalk.bold(credentials.user.email)}`);
  } catch (error) {
    spinner.stop();
    throw error;
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}

const statusAction = withErrorHandling(async (_: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals() as OutputOptions;
  const isInteractive = shouldUseInteractiveOutput(opts);
  const spinner = ora({
    text: 'Checking authentication status...',
    stream: process.stderr,
  }).start();
  const session = await validateSession();
  spinner.stop();

  if (!session) {
    const result = {
      authenticated: false,
      message: 'Not logged in. Run `purvey auth login` to authenticate.',
    };
    const error = new AuthError(result.message);

    if (isInteractive) {
      warn(result.message);
      process.exit(exitCodeForError(error));
    }

    outputData(result, opts);
    process.exit(exitCodeForError(error));
  }

  const result = {
    authenticated: true,
    email: session.email,
    role: session.role ?? 'authenticated',
    keyId: session.keyId,
    keyCreated: session.createdAt,
  };

  if (isInteractive) {
    success(`Logged in as ${chalk.bold(session.email)}`);
    info(`Role: ${result.role}`);
    info(`API key: ${result.keyId}`);
    info(`Created: ${result.keyCreated}`);
    return;
  }

  outputData(result, opts);
});

const logoutAction = withErrorHandling(async () => {
  await deleteCredentials();
  warn(
    'Local credentials cleared. The server API key remains active; revoke it from the Purveyors account key dashboard if this machine is lost or compromised.'
  );
});

export function buildAuthCommand(): Command {
  const auth = new Command('auth').description('Manage authentication with purveyors.io');

  auth
    .command('login')
    .description('Log in to purveyors.io')
    .option('--headless', 'Print the approval URL without opening a browser')
    .action(async (opts: { headless?: boolean }) => login(Boolean(opts.headless)))
    .addHelpText(
      'after',
      `
Examples:
  ${chalk.dim('# Browser login (opens the Purveyors approval page)')}
  purvey auth login

  ${chalk.dim('# Headless login (agents, SSH sessions, and remote servers)')}
  purvey auth login --headless
  ${chalk.dim('# → open the printed URL in any browser and approve access')}
  ${chalk.dim('# → the CLI completes automatically; nothing is pasted back')}

Notes:
  Credentials are stored at ~/.config/purvey/credentials.json (mode 0600).
  The CLI stores only the scoped Parchment API key returned after approval.
  Re-login atomically replaces the prior CLI key for this machine.
`
    );

  auth
    .command('status')
    .description('Show current authentication status')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--csv', 'Output as CSV')
    .addHelpText(
      'after',
      `
Examples:
  purvey auth status                     # human-readable in terminal, JSON when piped
  purvey auth status --json              # force compact JSON, even in a terminal
  purvey auth status --pretty            # indented colorized JSON
  purvey auth status | jq '.email'       # compact JSON on stdout
  purvey auth status --json 2>/dev/null | jq .

Output fields:
  authenticated  boolean — true if the stored API key is valid
  email          your Google account email
  role           your purveyors.io role (viewer or member)
  keyId          identifier of the stored Parchment API key
  keyCreated     ISO timestamp when the key was created

Notes:
  When stdout is a TTY (interactive terminal), output is human-readable unless
  you pass --json, --pretty, or --csv.
  When piped or redirected, output is compact JSON (same as all other commands).
`
    )
    .action(statusAction);

  auth
    .command('logout')
    .description('Clear stored credentials')
    .addHelpText(
      'after',
      `
Examples:
  purvey auth logout

Notes:
  Deletes ~/.config/purvey/credentials.json.
  Run 'purvey auth login' to authenticate again.
`
    )
    .action(logoutAction);

  return auth;
}
