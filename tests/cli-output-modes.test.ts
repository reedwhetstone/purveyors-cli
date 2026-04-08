import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function parseJson(text: string) {
  return JSON.parse(stripAnsi(text).trim()) as Record<string, unknown>;
}

describe('CLI output modes', () => {
  it('emits JSON for auth status --json in non-interactive mode', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'auth', 'status', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain('{"authenticated":false');
    expect(result.stdout).toContain('Not logged in. Run `purvey auth login` to authenticate.');
  }, 15000);

  it('emits JSON error envelopes for invalid sort with --json', () => {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/index.ts', 'catalog', 'search', '--sort', 'bogus', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(stderr).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
    });
    expect(stderr.message).toContain('Invalid --sort value: "bogus"');
  }, 15000);

  it('emits pretty JSON error envelopes for invalid sort with --pretty', () => {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/index.ts', 'catalog', 'search', '--sort', 'bogus', '--pretty'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const stripped = stripAnsi(result.stderr);
    const stderr = JSON.parse(stripped.trim()) as Record<string, unknown>;

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(stripped).toContain('\n  "error"');
    expect(stderr).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
    });
  }, 15000);

  it('keeps auth status human-readable in a TTY when no explicit mode is passed', () => {
    const result = spawnSync(
      'script',
      ['-e', '-q', '-c', 'CI=1 pnpm exec tsx src/index.ts auth status', '/dev/null'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(3);
    expect(output).toContain('Not logged in. Run `purvey auth login` to authenticate.');
    expect(output).toContain('⚠');
    expect(output).not.toContain('{"authenticated":false');
  }, 15000);

  it('keeps invalid sort errors human-readable in a TTY when no explicit mode is passed', () => {
    const result = spawnSync(
      'script',
      [
        '-e',
        '-q',
        '-c',
        'CI=1 pnpm exec tsx src/index.ts catalog search --sort bogus',
        '/dev/null',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(2);
    expect(output).toContain('✖ Invalid --sort value: "bogus"');
    expect(output).not.toContain('"error": true');
    expect(output).not.toContain('"code": "INVALID_ARGUMENT"');
  }, 15000);

  it('forces JSON for auth status --json even in a TTY', () => {
    const result = spawnSync(
      'script',
      ['-e', '-q', '-c', 'CI=1 pnpm exec tsx src/index.ts auth status --json', '/dev/null'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(3);
    expect(output).toContain('{"authenticated":false');
    expect(output).not.toContain('⚠ Not logged in. Run `purvey auth login` to authenticate.');
  }, 15000);

  it('emits JSON error envelopes when stderr is redirected from an interactive TTY', () => {
    const result = spawnSync(
      'script',
      [
        '-e',
        '-q',
        '-c',
        "bash -lc 'CI=1 pnpm exec tsx src/index.ts catalog search --sort bogus 2>/tmp/purvey-redirected-stderr.json; STATUS=$?; cat /tmp/purvey-redirected-stderr.json; rm -f /tmp/purvey-redirected-stderr.json; exit $STATUS'",
        '/dev/null',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);
    const stderr = JSON.parse(output.trim()) as Record<string, unknown>;

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
    });
    expect(stderr.message).toContain('Invalid --sort value: "bogus"');
  }, 15000);
});
