import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r/g, '');
}

function parseJson(text: string) {
  return JSON.parse(stripAnsi(text).trim()) as Record<string, unknown>;
}

/**
 * Run the CLI with an isolated HOME and no Parchment credentials. `baseUrl`
 * pins an unreachable API so the public (no-auth) slices can be exercised
 * deterministically: the request is attempted anonymously and fails on
 * connection, never on auth, and never touches production.
 */
function runCli(args: string[], baseUrl?: string) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-market-home-'));
  const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');
  return spawnSync(tsxBin, ['src/index.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
    env: {
      ...process.env,
      HOME: home,
      PARCHMENT_API_KEY: '',
      PURVEYORS_API_KEY: '',
      ...(baseUrl ? { PARCHMENT_API_BASE_URL: baseUrl } : {}),
    },
  });
}

describe('market command', () => {
  it('lists the three subcommands in help output', () => {
    const result = runCli(['market', '--help']);
    const stdout = stripAnsi(result.stdout);
    expect(result.status).toBe(0);
    expect(stdout).toContain('signals');
    expect(stdout).toContain('stats');
    expect(stdout).toContain('metadata');
  }, 15000);

  it('documents signals flags in help output', () => {
    const result = runCli(['market', 'signals', '--help']);
    const stdout = stripAnsi(result.stdout);
    expect(result.status).toBe(0);
    expect(stdout).toContain('--summary');
    expect(stdout).toContain('--type <type>');
    expect(stdout).toContain('--market <retail|wholesale|all>');
    expect(stdout).toContain('--window <7d|30d>');
  }, 15000);

  it('rejects an invalid --type before any network call', () => {
    const result = runCli(['market', 'signals', '--type', 'bogus', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--type');
  }, 15000);

  it('rejects an invalid --market before any network call', () => {
    const result = runCli(['market', 'signals', '--market', 'wholesalers', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--market');
  }, 15000);

  it('rejects a non-positive --baseline-weeks on stats', () => {
    const result = runCli(['market', 'stats', '--baseline-weeks', '0', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--baseline-weeks');
  }, 15000);

  it('rejects an out-of-range --baseline-weeks on stats', () => {
    const result = runCli(['market', 'stats', '--baseline-weeks', '53', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('between 8 and 52');
  }, 15000);

  it('rejects an invalid --dimension on metadata', () => {
    const result = runCli(['market', 'metadata', '--dimension', 'cultivar', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--dimension');
  }, 15000);

  it('rejects a malformed --from date on metadata', () => {
    const result = runCli(['market', 'metadata', '--from', '2026-6-1', '--json']);
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--from');
  }, 15000);

  it('attempts the public --summary slice anonymously (no auth error) even without credentials', () => {
    // Unreachable API: a public slice must pass validation + auth and fail on
    // the network call, proving the summary teaser needs no client-side auth.
    const result = runCli(['market', 'signals', '--summary', '--json'], 'http://127.0.0.1:1');
    expect(result.status).not.toBe(2); // not an argument error
    expect(result.status).not.toBe(3); // not an auth error — anonymous is allowed
    expect(result.status).not.toBe(0); // the unreachable host still fails the call
  }, 15000);
});
