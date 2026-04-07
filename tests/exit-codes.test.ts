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

function runFatalFixture(code: string) {
  return spawnSync('pnpm', ['exec', 'tsx', 'tests/fixtures/fatal-exit.ts', code], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe('CLI exit codes', () => {
  it('exits 2 for invalid catalog search sort values before auth', () => {
    const result = runCli(['catalog', 'search', '--sort', 'bogus']);
    const stderr = stripAnsi(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toContain('Invalid --sort value: "bogus"');
  }, 15000);

  it('exits 6 when the local config file is unreadable JSON', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-home-'));

    try {
      const configDir = join(tempHome, '.config', 'purvey');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), '{bad json\n', 'utf8');

      const result = runCli(['config', 'list'], { HOME: tempHome });
      const stderr = stripAnsi(result.stderr);

      expect(result.status).toBe(6);
      expect(stderr).toContain('Config file is invalid or unreadable');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('maps NOT_FOUND errors to exit code 4 at the process boundary', () => {
    const result = runFatalFixture('NOT_FOUND');
    const stderr = stripAnsi(result.stderr);

    expect(result.status).toBe(4);
    expect(stderr).toContain('Fixture error for NOT_FOUND');
  }, 15000);

  it('maps DEPENDENCY_CONFLICT errors to exit code 5 at the process boundary', () => {
    const result = runFatalFixture('DEPENDENCY_CONFLICT');
    const stderr = stripAnsi(result.stderr);

    expect(result.status).toBe(5);
    expect(stderr).toContain('Fixture error for DEPENDENCY_CONFLICT');
  }, 15000);
});
