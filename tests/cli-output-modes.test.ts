import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function parseJson(text: string) {
  return JSON.parse(stripAnsi(text).trim()) as Record<string, unknown>;
}

function runCliWithHome(args: string[], home: string) {
  return spawnSync(tsxBin, ['src/index.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function configFilePath(home: string) {
  return join(home, '.config', 'purvey', 'config.json');
}

function writeConfigFixture(home: string, raw: string) {
  const configDir = join(home, '.config', 'purvey');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFilePath(home), raw, 'utf8');
}

describe('CLI output modes', () => {
  it('emits JSON for auth status --json in non-interactive mode', () => {
    const result = spawnSync(tsxBin, ['src/index.ts', 'auth', 'status', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain('{"authenticated":false');
    expect(result.stdout).toContain('Not logged in. Run `purvey auth login` to authenticate.');
  }, 15000);

  it('emits JSON for config list --json in non-interactive mode', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-output-'));

    try {
      const result = spawnSync(tsxBin, ['src/index.ts', 'config', 'list', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });

      expect(result.status).toBe(0);
      expect(stripAnsi(result.stdout).trim()).toBe('{}');
      expect(stripAnsi(result.stderr).trim()).toBe('');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('emits null JSON payloads for unset config keys in machine mode', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-unset-'));

    try {
      const result = spawnSync(tsxBin, ['src/index.ts', 'config', 'get', 'form-mode', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });

      expect(result.status).toBe(0);
      expect(stripAnsi(result.stdout).trim()).toBe('{"form-mode":null}');
      expect(stripAnsi(result.stderr).trim()).toBe('');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('emits JSON for config get/set/reset in non-interactive mode without explicit flags', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-noninteractive-'));

    try {
      const setResult = spawnSync(tsxBin, ['src/index.ts', 'config', 'set', 'form-mode', 'true'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(setResult.status).toBe(0);
      expect(stripAnsi(setResult.stdout).trim()).toBe('{"form-mode":true}');
      expect(stripAnsi(setResult.stderr).trim()).toBe('');

      const getResult = spawnSync(tsxBin, ['src/index.ts', 'config', 'get', 'form-mode'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(getResult.status).toBe(0);
      expect(stripAnsi(getResult.stdout).trim()).toBe('{"form-mode":true}');
      expect(stripAnsi(getResult.stderr).trim()).toBe('');

      const resetResult = spawnSync(tsxBin, ['src/index.ts', 'config', 'reset'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(resetResult.status).toBe(0);
      expect(stripAnsi(resetResult.stdout).trim()).toBe('{}');
      expect(stripAnsi(resetResult.stderr).trim()).toBe('');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('emits JSON for config get/set/reset in machine mode', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-machine-'));

    try {
      const setResult = spawnSync(
        tsxBin,
        ['src/index.ts', 'config', 'set', 'form-mode', 'true', '--json'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, HOME: tempHome },
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      expect(setResult.status).toBe(0);
      expect(stripAnsi(setResult.stdout).trim()).toBe('{"form-mode":true}');
      expect(stripAnsi(setResult.stderr).trim()).toBe('');

      const getResult = spawnSync(
        tsxBin,
        ['src/index.ts', 'config', 'get', 'form-mode', '--json'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, HOME: tempHome },
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      expect(getResult.status).toBe(0);
      expect(stripAnsi(getResult.stdout).trim()).toBe('{"form-mode":true}');
      expect(stripAnsi(getResult.stderr).trim()).toBe('');

      const resetResult = spawnSync(tsxBin, ['src/index.ts', 'config', 'reset', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(resetResult.status).toBe(0);
      expect(stripAnsi(resetResult.stdout).trim()).toBe('{}');
      expect(stripAnsi(resetResult.stderr).trim()).toBe('');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('keeps config list human-readable in a TTY when no explicit mode is passed', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-tty-'));

    try {
      const shellHome = tempHome.replace(/'/g, "'\\''");
      const shellTsx = tsxBin.replace(/'/g, "'\\''");
      const result = spawnSync(
        'script',
        [
          '-e',
          '-q',
          '-c',
          `bash -lc 'HOME='\''${shellHome}'\'' CI=1 '\''${shellTsx}'\'' src/index.ts config set form-mode true >/dev/null 2>/dev/null && HOME='\''${shellHome}'\'' CI=1 '\''${shellTsx}'\'' src/index.ts config list'`,
          '/dev/null',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const output = stripAnsi(`${result.stdout}${result.stderr}`);

      expect(result.status).toBe(0);
      expect(output).toContain('form-mode = true');
      expect(output).not.toContain('{"form-mode":true}');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects --csv for config commands with a JSON error envelope', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-csv-'));

    try {
      const result = spawnSync(tsxBin, ['src/index.ts', 'config', 'list', '--csv'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, HOME: tempHome },
        maxBuffer: 10 * 1024 * 1024,
      });

      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(stderr).toMatchObject({
        error: true,
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
      });
      expect(stderr.message).toContain('The config commands do not support --csv');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects config set --csv without mutating config', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-set-csv-'));

    try {
      const originalConfig = `{
  "form-mode": false
}
`;
      writeConfigFixture(tempHome, originalConfig);

      const result = runCliWithHome(['config', 'set', 'form-mode', 'true', '--csv'], tempHome);
      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(stderr).toMatchObject({
        error: true,
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
      });
      expect(stderr.message).toContain('The config commands do not support --csv');
      expect(readFileSync(configFilePath(tempHome), 'utf8')).toBe(originalConfig);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects config reset --csv without mutating config', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-reset-csv-'));

    try {
      const originalConfig = `{
  "form-mode": true
}
`;
      writeConfigFixture(tempHome, originalConfig);

      const result = runCliWithHome(['config', 'reset', '--csv'], tempHome);
      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(stderr).toMatchObject({
        error: true,
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
      });
      expect(stderr.message).toContain('The config commands do not support --csv');
      expect(readFileSync(configFilePath(tempHome), 'utf8')).toBe(originalConfig);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects --csv before unreadable-config errors for config list/get/set', () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'purvey-config-unreadable-csv-'));

    try {
      const unreadableConfig = '{bad json\n';
      writeConfigFixture(tempHome, unreadableConfig);

      for (const args of [
        ['config', 'list', '--csv'],
        ['config', 'get', 'form-mode', '--csv'],
        ['config', 'set', 'form-mode', 'true', '--csv'],
      ]) {
        const result = runCliWithHome(args, tempHome);
        const stderr = parseJson(result.stderr);

        expect(result.status, args.join(' ')).toBe(2);
        expect(result.stdout, args.join(' ')).toBe('');
        expect(stderr, args.join(' ')).toMatchObject({
          error: true,
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
        });
        expect(String(stderr.message), args.join(' ')).toContain(
          'The config commands do not support --csv'
        );
        expect(readFileSync(configFilePath(tempHome), 'utf8'), args.join(' ')).toBe(
          unreadableConfig
        );
      }
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects --csv for context and manifest machine surfaces with JSON error envelopes', () => {
    for (const { args, message } of [
      {
        args: ['context', '--csv'],
        message: 'The context command does not support --csv. Use text, --json, or --pretty.',
      },
      {
        args: ['context', '--json', '--csv'],
        message: 'The context command does not support --csv. Use text, --json, or --pretty.',
      },
      {
        args: ['manifest', '--csv'],
        message: 'The manifest command does not support --csv. Use --json or --pretty.',
      },
      {
        args: ['manifest', '--pretty', '--csv'],
        message: 'The manifest command does not support --csv. Use --json or --pretty.',
      },
    ]) {
      const result = spawnSync(tsxBin, ['src/index.ts', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const stderr = parseJson(result.stderr);

      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(stderr, args.join(' ')).toMatchObject({
        error: true,
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
      });
      expect(String(stderr.message), args.join(' ')).toContain(message);
    }
  }, 15000);

  it('emits JSON error envelopes for invalid sort with --json', () => {
    const result = spawnSync(
      tsxBin,
      ['src/index.ts', 'catalog', 'search', '--sort', 'bogus', '--json'],
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
      tsxBin,
      ['src/index.ts', 'catalog', 'search', '--sort', 'bogus', '--pretty'],
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

  it('keeps unknown option parse errors human-readable in a TTY with no explicit mode', () => {
    const result = spawnSync(
      'script',
      ['-e', '-q', '-c', 'CI=1 pnpm exec tsx src/index.ts catalog search --bogus', '/dev/null'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(2);
    expect(output).toContain("✖ Unknown option '--bogus'");
    expect(output).not.toContain('"error": true');
  }, 15000);

  it('keeps unknown command parse errors human-readable in a TTY with no explicit mode', () => {
    const result = spawnSync(
      'script',
      ['-e', '-q', '-c', 'CI=1 pnpm exec tsx src/index.ts catlog', '/dev/null'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(2);
    expect(output).toContain("✖ Unknown command 'catlog'");
    expect(output).toContain('Did you mean catalog?');
    expect(output).not.toContain('"code": "INVALID_ARGUMENT"');
  }, 15000);

  it('keeps missing required argument parse errors human-readable in a TTY with no explicit mode', () => {
    const result = spawnSync(
      'script',
      ['-e', '-q', '-c', 'CI=1 pnpm exec tsx src/index.ts catalog get', '/dev/null'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.status).toBe(2);
    expect(output).toContain("✖ Missing required argument 'id'");
    expect(output).not.toContain('"error": true');
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

  it('emits JSON parse-error envelopes when stderr is redirected from an interactive TTY', () => {
    const result = spawnSync(
      'script',
      [
        '-e',
        '-q',
        '-c',
        "bash -lc 'CI=1 pnpm exec tsx src/index.ts catalog search --bogus 2>/tmp/purvey-parse-stderr.json; STATUS=$?; cat /tmp/purvey-parse-stderr.json; rm -f /tmp/purvey-parse-stderr.json; exit $STATUS'",
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
      message: "Unknown option '--bogus'",
    });
  }, 15000);
});
