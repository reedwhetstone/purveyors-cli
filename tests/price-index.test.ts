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
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-price-index-home-'));
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

describe('price-index command', () => {
  it('documents its filter and pagination options in help output', () => {
    const result = runCli(['price-index', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('--origin <origin>');
    expect(stdout).toContain('--process <method>');
    expect(stdout).toContain('--grade <grade>');
    expect(stdout).toContain('--from <date>');
    expect(stdout).toContain('--to <date>');
    expect(stdout).toContain('--wholesale <true|false>');
    expect(stdout).toContain('--page <n>');
    expect(stdout).toContain('--limit <n>');
  }, 15000);

  it('rejects a non-positive --page before auth', () => {
    const result = runCli(['price-index', '--page', '0', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--page');
  }, 15000);

  it('rejects an invalid --wholesale value before auth', () => {
    const result = runCli(['price-index', '--wholesale', 'maybe', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--wholesale');
  }, 15000);

  it('requires a session or API key when none is configured', () => {
    const result = runCli(['price-index', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(3);
    expect(stderr).toMatchObject({ error: true, code: 'AUTH_ERROR', exitCode: 3 });
  }, 15000);
});
