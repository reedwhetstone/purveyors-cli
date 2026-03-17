import { Command } from 'commander';
import { createServer } from 'http';
import { createAnonClient, validateSession } from '../lib/supabase.js';
import { writeCredentials, deleteCredentials } from '../lib/config.js';
import { outputData, success, info, warn } from '../lib/output.js';
import { withErrorHandling, AuthError } from '../lib/errors.js';
import type { StoredCredentials } from '../types/index.js';
import chalk from 'chalk';
import ora from 'ora';

const DEFAULT_CALLBACK_HOST = 'localhost';
const CALLBACK_PATH = '/auth/callback';

interface CallbackResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface CallbackServer {
  port: number;
  tokenPromise: Promise<CallbackResult>;
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
    let tokenResolve!: (val: CallbackResult) => void;
    let tokenReject!: (err: Error) => void;

    const tokenPromise = new Promise<CallbackResult>((res, rej) => {
      tokenResolve = res;
      tokenReject = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${DEFAULT_CALLBACK_HOST}`);

      if (url.pathname === CALLBACK_PATH) {
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
            const { access_token, refresh_token, expires_in } = JSON.parse(body) as {
              access_token?: string;
              refresh_token?: string;
              expires_in?: string;
            };

            if (!access_token || !refresh_token) {
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
      resolve({ port: addr.port, tokenPromise });
    });

    server.on('error', (err) => reject(err));
  });
}

/**
 * `purvey auth login`
 * Opens a browser for Google OAuth via Supabase, captures the callback token.
 */
const loginAction = withErrorHandling(async () => {
  const { port, tokenPromise } = await startCallbackServer();
  const redirectTo = `http://${DEFAULT_CALLBACK_HOST}:${port}${CALLBACK_PATH}`;

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error || !data.url) {
    throw new AuthError('Failed to generate OAuth URL.', error);
  }

  console.log(chalk.bold('\n  Opening browser for authentication...'));
  console.log(chalk.dim(`  If the browser does not open, visit:\n  ${data.url}\n`));

  // Open browser cross-platform (graceful fallback for headless)
  try {
    const { spawn } = await import('child_process');
    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const child = spawn(openCmd, [data.url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      // Browser open failed (headless environment) — user can visit URL manually
    });
    child.unref();
  } catch {
    // Gracefully ignore — URL is already printed above
  }

  const spinner = ora('Waiting for authentication...').start();
  const { accessToken, refreshToken, expiresIn } = await tokenPromise;
  spinner.succeed('Authentication received');

  // Fetch user info to confirm identity
  const client = createAnonClient();
  await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  const {
    data: { user },
  } = await client.auth.getUser();

  const creds: StoredCredentials = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    user: {
      id: user?.id ?? 'unknown',
      email: user?.email ?? 'unknown',
      role: user?.role,
    },
  };

  await writeCredentials(creds);
  success(`Logged in as ${chalk.bold(creds.user.email)}`);
});

/**
 * `purvey auth status`
 * Shows current login state and token info.
 */
const statusAction = withErrorHandling(async (_: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals() as { pretty?: boolean; csv?: boolean };
  const spinner = ora('Checking authentication status...').start();
  const session = await validateSession();
  spinner.stop();

  if (!session) {
    const result = {
      authenticated: false,
      message: 'Not logged in. Run `purvey auth login` to authenticate.',
    };
    if (!opts.pretty && !opts.csv) {
      warn(result.message);
      process.exit(1);
    }
    outputData(result, opts);
    process.exit(1);
  }

  const result = {
    authenticated: true,
    email: session.email,
    role: session.role ?? 'authenticated',
    tokenExpires: new Date(session.expiresAt).toISOString(),
  };

  if (!opts.pretty && !opts.csv) {
    success(`Logged in as ${chalk.bold(session.email)}`);
    info(`Role: ${result.role}`);
    info(`Token expires: ${result.tokenExpires}`);
    return;
  }

  outputData(result, opts);
});

/**
 * `purvey auth login --email --password`
 * Headless login with email/password (for agents and CI).
 */
const headlessLoginAction = withErrorHandling(async (opts: { email: string; password: string }) => {
  if (!opts.email || !opts.password) {
    throw new AuthError(
      'Both --email and --password are required for headless login.\n' +
        '  Usage: purvey auth login --email user@example.com --password yourpassword'
    );
  }

  const spinner = ora('Authenticating...').start();
  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: opts.email,
    password: opts.password,
  });

  if (error || !data.session) {
    spinner.fail('Authentication failed');
    throw new AuthError(error?.message ?? 'Invalid credentials. Check your email and password.');
  }

  const { session, user } = data;

  const creds: StoredCredentials = {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: Date.now() + session.expires_in * 1000,
    user: {
      id: user.id,
      email: user.email ?? 'unknown',
      role: user.role,
    },
  };

  await writeCredentials(creds);
  spinner.succeed(`Logged in as ${chalk.bold(creds.user.email)}`);
});

/**
 * `purvey auth login --token`
 * Direct token login (for environments where OAuth callback isn't possible).
 */
const tokenLoginAction = withErrorHandling(async (opts: { token: string }) => {
  if (!opts.token) {
    throw new AuthError(
      '--token is required.\n' + '  Usage: purvey auth login --token <access_token>'
    );
  }

  const spinner = ora('Validating token...').start();
  const supabase = createAnonClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(opts.token);

  if (error || !user) {
    spinner.fail('Token validation failed');
    throw new AuthError('Invalid or expired token.');
  }

  // We don't have a refresh token in this mode, so set a shorter expiry
  const creds: StoredCredentials = {
    accessToken: opts.token,
    refreshToken: '', // No refresh token — session will expire
    expiresAt: Date.now() + 3600 * 1000, // 1 hour default
    user: {
      id: user.id,
      email: user.email ?? 'unknown',
      role: user.role,
    },
  };

  await writeCredentials(creds);
  spinner.succeed(`Logged in as ${chalk.bold(creds.user.email)}`);
  info('Note: Token login has no refresh capability. Re-authenticate when token expires.');
});

/**
 * `purvey auth logout`
 * Clears stored credentials from disk.
 */
const logoutAction = withErrorHandling(async () => {
  await deleteCredentials();
  success('Logged out successfully.');
});

/**
 * Build and return the `auth` command subtree.
 */
export function buildAuthCommand(): Command {
  const auth = new Command('auth').description('Manage authentication with purveyors.io');

  const login = auth
    .command('login')
    .description('Log in to purveyors.io')
    .option('--email <email>', 'Email address (for headless/agent login)')
    .option('--password <password>', 'Password (for headless/agent login)')
    .option('--token <token>', 'Access token (for direct token login)')
    .action(async (opts) => {
      if (opts.token) {
        return tokenLoginAction(opts);
      }
      if (opts.email || opts.password) {
        return headlessLoginAction(opts);
      }
      // Default: browser OAuth flow
      return loginAction();
    });

  login.addHelpText(
    'after',
    `
Examples:
  ${chalk.dim('# Browser login (interactive, opens Google OAuth)')}
  purvey auth login

  ${chalk.dim('# Headless login (agents, CI, servers)')}
  purvey auth login --email user@example.com --password yourpassword

  ${chalk.dim('# Direct token login (from existing session)')}
  purvey auth login --token eyJhbGciOi...

  ${chalk.dim('# Environment variables (CI/automation)')}
  PURVEY_EMAIL=user@example.com PURVEY_PASSWORD=pass purvey auth login --email "$PURVEY_EMAIL" --password "$PURVEY_PASSWORD"
`
  );

  auth
    .command('status')
    .description('Show current authentication status')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--csv', 'Output as CSV')
    .action(statusAction);

  auth.command('logout').description('Clear stored credentials').action(logoutAction);

  return auth;
}
