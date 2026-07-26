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
 * Run the CLI with an isolated HOME and no Parchment credentials/API key so
 * the auth-required path is deterministic and no network call is made.
 */
function runCli(args: string[]) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-procurement-home-'));
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
    },
  });
}

describe('procurement command', () => {
  it('lists the read subcommands in help output', () => {
    const result = runCli(['procurement', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('list');
    expect(stdout).toContain('get');
    expect(stdout).toContain('matches');
  }, 15000);

  it('documents pagination options on matches', () => {
    const result = runCli(['procurement', 'matches', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('--page <n>');
    expect(stdout).toContain('--limit <n>');
  }, 15000);

  it('requires a brief id for get', () => {
    const result = runCli(['procurement', 'get', '--json']);

    expect(result.status).toBe(2);
  }, 15000);

  it('rejects a non-positive --limit on matches before auth', () => {
    const result = runCli(['procurement', 'matches', 'some-id', '--limit', '0', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--limit');
  }, 15000);

  it('rejects malformed and out-of-range --limit values before auth', () => {
    for (const value of ['25rows', '101']) {
      const result = runCli(['procurement', 'matches', 'some-id', '--limit', value, '--json']);
      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(2);
      expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
      expect(stderr.message).toContain('--limit');
    }
  }, 30000);

  it('requires a session or API key for list when none is configured', () => {
    const result = runCli(['procurement', 'list', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(3);
    expect(stderr).toMatchObject({ error: true, code: 'AUTH_ERROR', exitCode: 3 });
  }, 15000);
});
