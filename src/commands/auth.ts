import { Command } from 'commander';
import { createServer } from 'http';
import { validateSession } from '../lib/auth-client.js';
import { writeCredentials, deleteCredentials } from '../lib/config.js';
import { outputData, shouldUseInteractiveOutput, success, info, warn } from '../lib/output.js';
import { withErrorHandling, AuthError, exitCodeForError } from '../lib/errors.js';
import type { OutputOptions, StoredCredentials } from '../types/index.js';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { createParchmentClient, type ParchmentClient } from '@purveyors/sdk';
import { getParchmentBaseUrl } from '../lib/parchment-base.js';
import { hostname } from 'os';
import { randomUUID } from 'crypto';

const DEFAULT_CALLBACK_HOST = 'localhost';
const CALLBACK_PATH = '/auth/callback';
const SUPABASE_AUTH_URL =
  process.env.PURVEYORS_SUPABASE_URL || 'https://bjblfzfdtfvuitqdbodn.supabase.co';
const CLI_API_KEY_SCOPES = [
  // The canonical API uses catalog:read for catalog, Market Index,
  // Price Index, and procurement reads; those data planes do not define
  // separate key scopes.
  'catalog:read',
  'inventory:read',
  'inventory:write',
  'roast:read',
  'roast:write',
  'sales:read',
  'sales:write',
  'tasting:read',
  'tasting:write',
] as const;

interface CallbackResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface CallbackServer {
  port: number;
  state: string;
  tokenPromise: Promise<CallbackResult>;
  close: () => void;
}

interface ManualCallbackReader {
  promise: Promise<CallbackResult>;
  close: () => void;
}

type ManualCallbackQuestion = (query: string, callback: (answer: string) => void) => void;

export function createOAuthUrl(redirectTo: string): string {
  const url = new URL('/auth/v1/authorize', SUPABASE_AUTH_URL);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

function decodeSessionIdentity(accessToken: string): StoredCredentials['user'] {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    return {
      id: typeof payload.sub === 'string' ? payload.sub : 'unknown',
      email: typeof payload.email === 'string' ? payload.email : 'unknown',
      role: typeof payload.role === 'string' ? payload.role : undefined,
    };
  } catch {
    return { id: 'unknown', email: 'unknown' };
  }
}

export async function exchangeOAuthSessionForApiKey(
  accessToken: string,
  clientOverride?: ParchmentClient
): Promise<StoredCredentials> {
  const client =
    clientOverride ?? createParchmentClient({ baseUrl: getParchmentBaseUrl(), token: accessToken });
  const me = await client.me();
  if (!me.response.ok || me.error || !me.data?.authenticated || !me.data.userId) {
    throw new AuthError('OAuth session could not be verified by Parchment.');
  }
  const keyName = `purvey-cli-${hostname()}`;
  const existing = await client.apiKeys.list();
  if (!existing.response.ok || existing.error) {
    throw new AuthError('Failed to inspect existing CLI API keys.', existing.error);
  }
  const supersededKeys = (existing.data?.data ?? []).filter(
    (key) => key.name === keyName && key.isActive
  );
  const result = await client.apiKeys.create({
    name: keyName,
    scopes: [...CLI_API_KEY_SCOPES],
  });
  if (!result.response.ok || result.error || !result.data?.apiKey) {
    throw new AuthError('Failed to create a scoped Parchment API key.', result.error);
  }
  for (const key of supersededKeys) {
    const revoked = await client.apiKeys.revoke(key.id);
    if (!revoked.response.ok || revoked.error) {
      await client.apiKeys.revoke(result.data.key.id).catch(() => undefined);
      throw new AuthError('Failed to replace the existing CLI API key.', revoked.error);
    }
  }
  const identity = decodeSessionIdentity(accessToken);
  return {
    apiKey: result.data.apiKey,
    keyId: result.data.key.id,
    createdAt: result.data.key.createdAt ?? new Date().toISOString(),
    user: {
      ...identity,
      id: me.data.userId,
      role: me.data.primaryAppRole ?? identity.role,
    },
  };
}

/**
 * Start a one-shot local HTTP server to receive the Supabase OAuth callback.
 *
 * Supabase delivers tokens in the URL fragment (#access_token=...) which is
 * client-side only. We serve a minimal HTML page that extracts the fragment
 * values and POSTs them back to the local server, then resolves the promise.
 */
function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    const state = randomUUID();
    let tokenResolve!: (val: CallbackResult) => void;
    let tokenReject!: (err: Error) => void;

    const tokenPromise = new Promise<CallbackResult>((res, rej) => {
      tokenResolve = res;
      tokenReject = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${DEFAULT_CALLBACK_HOST}`);

      if (url.pathname === CALLBACK_PATH && url.searchParams.get('state') === state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body>
<p>Completing authentication, please wait...</p>
<script>
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  fetch('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
      expires_in: params.get('expires_in'),
      state: new URLSearchParams(window.location.search).get('state'),
    })
  }).then(() => {
    document.body.innerHTML =
      '<h2 style="font-family:sans-serif;color:#2d6a4f;">✔ Authenticated! You can close this tab.</h2>';
  });
</script>
</body>
</html>`);
        return;
      }

      if (url.pathname === '/auth/token' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.writeHead(200);
          res.end('ok');
          server.close();

          try {
            const {
              access_token,
              refresh_token,
              expires_in,
              state: callbackState,
            } = JSON.parse(body) as {
              access_token?: string;
              refresh_token?: string;
              expires_in?: string;
              state?: string;
            };

            if (!access_token || !refresh_token || callbackState !== state) {
              tokenReject(new AuthError('OAuth callback did not include tokens. Try again.'));
              return;
            }

            tokenResolve({
              accessToken: access_token,
              refreshToken: refresh_token,
              expiresIn: parseInt(expires_in ?? '3600', 10),
            });
          } catch {
            tokenReject(new AuthError('Failed to parse OAuth callback response.'));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, DEFAULT_CALLBACK_HOST, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new AuthError('Failed to start callback server.'));
        return;
      }
      resolve({
        port: addr.port,
        state,
        tokenPromise,
        close: () => {
          try {
            server.close();
          } catch {
            // Server may already be closed after an automatic callback.
          }
        },
      });
    });

    server.on('error', (err) => reject(err));
  });
}

/**
 * Extract Supabase OAuth tokens from a full callback URL, URL fragment, or
 * query string. Exported for auth-flow contract tests.
 */
export function parseOAuthCallbackUrl(callbackUrl: string, expectedState?: string): CallbackResult {
  const trimmed = callbackUrl.trim();

  if (!trimmed) {
    throw new AuthError('No URL provided.');
  }

  // Supabase usually puts tokens in the fragment:
  // #access_token=...&refresh_token=...
  let tokenStr = '';
  if (trimmed.includes('#')) {
    tokenStr = trimmed.split('#')[1] ?? '';
  } else if (trimmed.includes('?')) {
    tokenStr = trimmed.split('?').slice(1).join('?');
  } else {
    // Allow pasting just the fragment/query content.
    tokenStr = trimmed;
  }

  const params = new URLSearchParams(tokenStr);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = params.get('expires_in');

  if (expectedState) {
    const parsedUrl = new URL(trimmed, 'http://localhost');
    if (parsedUrl.searchParams.get('state') !== expectedState) {
      throw new AuthError('OAuth callback state did not match this login attempt.');
    }
  }

  if (!accessToken || !refreshToken) {
    throw new AuthError(
      'Could not extract tokens from the URL.\n' +
        '  Make sure you copied the full callback URL including the #access_token=... part.'
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: parseInt(expiresIn ?? '3600', 10),
  };
}

export function createManualCallbackReaderForQuestion(
  question: ManualCallbackQuestion,
  closeQuestion: () => void,
  canRead: boolean,
  expectedState?: string
): ManualCallbackReader | null {
  if (!canRead) return null;

  let closed = false;
  const prompt = chalk.bold('  If the browser cannot return here, paste the full callback URL: ');

  const promise = new Promise<CallbackResult>((resolve) => {
    const ask = () => {
      if (closed) return;

      question(prompt, (answer) => {
        if (closed) return;

        try {
          const callbackResult = parseOAuthCallbackUrl(answer, expectedState);
          closed = true;
          closeQuestion();
          resolve(callbackResult);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to parse callback URL.';
          console.log(chalk.yellow(`  Ignoring invalid callback URL: ${message}`));
          console.log(
            chalk.dim('  Still waiting for the browser callback; paste a valid URL to retry.')
          );
          ask();
        }
      });
    };

    ask();
  });

  return {
    promise,
    close: () => {
      if (closed) return;
      closed = true;
      closeQuestion();
    },
  };
}

function createManualCallbackReader(expectedState: string): ManualCallbackReader | null {
  if (!process.stdin.isTTY) return null;

  const rl: ReadlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return createManualCallbackReaderForQuestion(
    rl.question.bind(rl),
    () => rl.close(),
    process.stdin.isTTY,
    expectedState
  );
}

/**
 * `purvey auth login`
 * Opens a browser for Google OAuth via Supabase, captures the callback token.
 */
const loginAction = withErrorHandling(async () => {
  const callbackServer = await startCallbackServer();
  const { port, state, tokenPromise } = callbackServer;
  const redirectTo = `http://${DEFAULT_CALLBACK_HOST}:${port}${CALLBACK_PATH}?state=${encodeURIComponent(state)}`;

  try {
    const oauthUrl = createOAuthUrl(redirectTo);

    console.log(chalk.bold('\n  Opening browser for authentication...'));
    console.log(chalk.dim(`  If the browser does not open, visit:\n  ${oauthUrl}\n`));
    console.log(
      chalk.dim(
        '  Waiting for the browser callback. If the browser lands on a localhost URL but\n' +
          '  the CLI does not finish, copy that full URL and paste it below.\n'
      )
    );

    // Open browser cross-platform (graceful fallback for headless)
    try {
      const { spawn } = await import('child_process');
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      const child = spawn(openCmd, [oauthUrl], { detached: true, stdio: 'ignore' });
      child.on('error', () => {
        // Browser open failed (headless environment) — user can visit URL manually
      });
      child.unref();
    } catch {
      // Gracefully ignore — URL is already printed above
    }

    const manualReader = createManualCallbackReader(state);
    const spinner = ora({ text: 'Waiting for authentication...', stream: process.stderr }).start();

    let callbackResult: CallbackResult;
    try {
      callbackResult = await Promise.race([
        tokenPromise,
        ...(manualReader ? [manualReader.promise] : []),
      ]);
    } finally {
      manualReader?.close();
    }

    const { accessToken } = callbackResult;
    spinner.succeed('Authentication received');
    const creds = await exchangeOAuthSessionForApiKey(accessToken);

    await writeCredentials(creds);
    success(`Logged in as ${chalk.bold(creds.user.email)}`);
  } finally {
    callbackServer.close();
  }
});

/**
 * `purvey auth status`
 * Shows current login state and token info.
 */
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

/**
 * `purvey auth login --headless`
 * Headless login for agents and servers. Generates OAuth URL, user pastes back callback.
 */
const headlessLoginAction = withErrorHandling(async () => {
  // Generate OAuth URL with purveyors.io callback page as redirect
  const state = randomUUID();
  const redirectTo = new URL('https://purveyors.io/auth/cli-callback');
  redirectTo.searchParams.set('state', state);
  const oauthUrl = createOAuthUrl(redirectTo.toString());

  console.log(chalk.bold('\n  Headless Login\n'));
  console.log('  1. Open this URL in a browser and sign in:\n');
  console.log(`     ${chalk.cyan(oauthUrl)}\n`);
  console.log("  2. After login, you'll see a page with a callback URL.");
  console.log('  3. Copy the full callback URL and paste it below.\n');

  // Read the callback URL from stdin
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const callbackUrl = await new Promise<string>((resolve) => {
    rl.question(chalk.bold('  Paste callback URL: '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!callbackUrl) {
    throw new AuthError('No URL provided.');
  }

  const { accessToken } = parseOAuthCallbackUrl(callbackUrl, state);

  const spinner = ora({ text: 'Validating session...', stream: process.stderr }).start();
  const creds = await exchangeOAuthSessionForApiKey(accessToken);

  await writeCredentials(creds);
  spinner.succeed(`Logged in as ${chalk.bold(creds.user.email)}`);
});

/**
 * `purvey auth logout`
 * Clears stored credentials from disk.
 */
const logoutAction = withErrorHandling(async () => {
  await deleteCredentials();
  warn(
    'Local credentials cleared. The server API key remains active; revoke it from the Purveyors account key dashboard if this machine is lost or compromised.'
  );
});

/**
 * Build and return the `auth` command subtree.
 */
export function buildAuthCommand(): Command {
  const auth = new Command('auth').description('Manage authentication with purveyors.io');

  const login = auth
    .command('login')
    .description('Log in to purveyors.io')
    .option('--headless', 'Headless login (prints URL, you paste back the callback)')
    .action(async (opts) => {
      if (opts.headless) {
        return headlessLoginAction();
      }
      // Default: browser OAuth flow
      return loginAction();
    });

  login.addHelpText(
    'after',
    `
Examples:
  ${chalk.dim('# Browser login (interactive, opens Google OAuth in default browser)')}
  purvey auth login

  ${chalk.dim('# Headless login (agents, CI, servers — no browser required)')}
  purvey auth login --headless
  ${chalk.dim('# → prints a Google OAuth URL')}
  ${chalk.dim('# → open URL, sign in with Google')}
  ${chalk.dim('# → copy the full callback URL from the browser')}
  ${chalk.dim('# → paste it back at the prompt')}

Notes:
  Credentials are stored at ~/.config/purvey/credentials.json (mode 0600).
  OAuth is used once to mint a scoped Parchment API key; session tokens are not retained.
  Re-login replaces the prior CLI key for this machine.
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
