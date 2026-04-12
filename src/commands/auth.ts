import { Command } from 'commander';
import { createServer } from 'http';
import { createAnonClient, validateSession } from '../lib/supabase.js';
import { writeCredentials, deleteCredentials } from '../lib/config.js';
import { outputData, shouldUseInteractiveOutput, success, info, warn } from '../lib/output.js';
import { withErrorHandling, AuthError, exitCodeForError } from '../lib/errors.js';
import type { OutputOptions, StoredCredentials } from '../types/index.js';
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

export function extractCallbackResult(callbackInput: string): CallbackResult {
  const trimmed = callbackInput.trim();

  if (!trimmed) {
    throw new AuthError('No URL provided.');
  }

  let tokenStr = trimmed;
  if (trimmed.includes('#')) {
    tokenStr = trimmed.split('#').slice(1).join('#');
  } else if (trimmed.includes('?')) {
    tokenStr = trimmed.split('?').slice(1).join('?');
  }

  const params = new URLSearchParams(tokenStr);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = params.get('expires_in');

  if (!accessToken || !refreshToken) {
    throw new AuthError(
      'Could not extract tokens from the callback URL.\n' +
        '  Make sure you copied the full callback URL including the access_token and refresh_token.'
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: parseInt(expiresIn ?? '3600', 10),
  };
}

/**
 * Start a one-shot local HTTP server to receive the Supabase OAuth callback.
 *
 * OAuth providers may deliver session tokens in the callback URL fragment or
 * query string, both of which are only available client-side. We serve a
 * minimal HTML page that POSTs the full callback URL back to the local server,
 * which parses and validates the returned tokens before resolving the promise.
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
  fetch('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_url: window.location.href,
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
            const { callback_url, access_token, refresh_token, expires_in } = JSON.parse(body) as {
              callback_url?: string;
              access_token?: string;
              refresh_token?: string;
              expires_in?: string;
            };

            if (callback_url) {
              tokenResolve(extractCallbackResult(callback_url));
              return;
            }

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

  const spinner = ora({ text: 'Waiting for authentication...', stream: process.stderr }).start();
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
    tokenExpires: new Date(session.expiresAt).toISOString(),
  };

  if (isInteractive) {
    success(`Logged in as ${chalk.bold(session.email)}`);
    info(`Role: ${result.role}`);
    info(`Token expires: ${result.tokenExpires}`);
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
  const redirectTo = 'https://purveyors.io/auth/cli-callback';
  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    throw new AuthError('Failed to generate OAuth URL.');
  }

  console.log(chalk.bold('\n  Headless Login\n'));
  console.log('  1. Open this URL in a browser and sign in:\n');
  console.log(`     ${chalk.cyan(data.url)}\n`);
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
  const { accessToken, refreshToken, expiresIn } = extractCallbackResult(callbackUrl);

  const spinner = ora({ text: 'Validating session...', stream: process.stderr }).start();
  const client = createAnonClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser(accessToken);

  if (userError || !user) {
    spinner.fail('Token validation failed');
    throw new AuthError('Invalid or expired token. Try the login flow again.');
  }

  const creds: StoredCredentials = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
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
  Tokens auto-refresh; no need to re-login between sessions.
  Uses Google OAuth via Supabase — same account as purveyors.io web app.
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
  authenticated  boolean — true if a valid session exists
  email          your Google account email
  role           your purveyors.io role (viewer or member)
  tokenExpires   ISO timestamp when the access token expires

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
