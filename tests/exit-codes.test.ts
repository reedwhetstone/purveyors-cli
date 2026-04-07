import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function parseJson(text: string) {
  return JSON.parse(stripAnsi(text).trim()) as Record<string, unknown>;
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runFatalFixture(code: string, extraArgs: string[] = []) {
  return spawnSync('pnpm', ['exec', 'tsx', 'tests/fixtures/fatal-exit.ts', code, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe('CLI exit codes', () => {
  it('exits 2 for invalid catalog search sort values before auth', () => {
    const result = runCli(['catalog', 'search', '--sort', 'bogus']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
    });
    expect(stderr.message).toContain('Invalid --sort value: "bogus"');
  }, 15000);

  it('exits 6 when the local config file is unreadable JSON', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-home-'));

    try {
      const configDir = join(tempHome, '.config', 'purvey');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), '{bad json\n', 'utf8');

      const result = runCli(['config', 'list'], { HOME: tempHome });
      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(6);
      expect(stderr).toMatchObject({
        error: true,
        code: 'CONFIG_ERROR',
        exitCode: 6,
      });
      expect(stderr.message).toContain('Config file is invalid or unreadable');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('maps AUTH_ERROR errors to exit code 3 at the process boundary', () => {
    const result = runFatalFixture('AUTH_ERROR', ['--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(3);
    expect(stderr).toMatchObject({
      error: true,
      code: 'AUTH_ERROR',
      exitCode: 3,
      message: 'Fixture error for AUTH_ERROR',
    });
  }, 15000);

  it('maps NOT_FOUND errors to exit code 4 at the process boundary', () => {
    const result = runFatalFixture('NOT_FOUND', ['--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(4);
    expect(stderr).toMatchObject({
      error: true,
      code: 'NOT_FOUND',
      exitCode: 4,
      message: 'Fixture error for NOT_FOUND',
    });
  }, 15000);

  it('maps DEPENDENCY_CONFLICT errors to exit code 5 at the process boundary', () => {
    const result = runFatalFixture('DEPENDENCY_CONFLICT', ['--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(5);
    expect(stderr).toMatchObject({
      error: true,
      code: 'DEPENDENCY_CONFLICT',
      exitCode: 5,
      message: 'Fixture error for DEPENDENCY_CONFLICT',
    });
  }, 15000);
});
