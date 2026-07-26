import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCli(args: string[], options: { formMode?: boolean } = {}) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-numeric-command-home-'));
  try {
    if (options.formMode !== undefined) {
      const configDir = resolve(home, '.config', 'purvey');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        resolve(configDir, 'config.json'),
        JSON.stringify({ 'form-mode': options.formMode }) + '\n',
        'utf8'
      );
    }

    return spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
      env: {
        ...process.env,
        HOME: home,
        COREPACK_HOME:
          process.env.COREPACK_HOME ?? resolve(process.env.HOME ?? home, '.cache/node/corepack'),
      },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function parseError(stderr: string) {
  return JSON.parse(stderr.trim()) as {
    code: string;
    exitCode: number;
    message: string;
  };
}

describe('strict numeric command input', () => {
  it.each([
    {
      label: 'inventory quantity',
      args: ['inventory', 'add', '--catalog-id', '1', '--qty', '5kg', '--json'],
      message: 'Invalid --qty: "5kg"',
    },
    {
      label: 'roast input weight',
      args: ['roast', 'create', '--coffee-id', '1', '--oz-in', '12oz', '--json'],
      message: 'Invalid --oz-in: "12oz"',
    },
  ])('rejects suffixed $label before authentication', ({ args, message }) => {
    const result = runCli(args);
    const error = parseError(result.stderr);

    expect(result.status).toBe(2);
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(error.message).toContain(message);
  });

  it.each([
    {
      label: 'inventory delete ID',
      args: ['inventory', 'delete', '7oops', '--yes', '--json'],
      message: 'Invalid inventory ID: "7oops"',
    },
    {
      label: 'sales delete ID',
      args: ['sales', 'delete', '7oops', '--yes', '--json'],
      message: 'Invalid sale ID: "7oops"',
    },
    {
      label: 'roast delete ID',
      args: ['roast', 'delete', '7oops', '--yes', '--json'],
      message: 'Invalid roast ID: "7oops"',
    },
  ])('rejects a suffixed destructive $label before authentication', ({ args, message }) => {
    const result = runCli(args);
    const error = parseError(result.stderr);

    expect(result.status).toBe(2);
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(error.message).toContain(message);
  });

  it.each([
    ['inventory', ['inventory', 'list', '--limit', '20rows', '--json'], '--limit'],
    ['roast', ['roast', 'list', '--offset', '10rows', '--json'], '--offset'],
    ['sales', ['sales', 'list', '--limit', '20rows', '--json'], '--limit'],
  ])('rejects suffixed %s pagination before authentication', (_label, args, flag) => {
    const result = runCli(args);
    const error = parseError(result.stderr);

    expect(result.status).toBe(2);
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(error.message).toContain(flag);
  });

  it('validates roast flags instead of auto-entering form mode when the required selector is present', () => {
    const result = runCli(['roast', 'create', '--coffee-id', '1', '--oz-in', '12oz', '--json'], {
      formMode: true,
    });
    const error = parseError(result.stderr);

    expect(result.status).toBe(2);
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(error.message).toContain('Invalid --oz-in: "12oz"');
  });
});
