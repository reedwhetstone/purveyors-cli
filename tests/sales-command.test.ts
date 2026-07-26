import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function runCli(args: string[], options: { formMode?: boolean; timeout?: number } = {}) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-sales-command-home-'));

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
    timeout: options.timeout ?? 15000,
    env: {
      ...process.env,
      HOME: home,
      COREPACK_HOME:
        process.env.COREPACK_HOME ?? resolve(process.env.HOME ?? home, '.cache/node/corepack'),
    },
  });
}

describe('sales record command', () => {
  it('documents both selector modes in help output', () => {
    const result = runCli(['sales', 'record', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('--roast-id <id>');
    expect(stdout).toContain('--coffee-id <id>');
    expect(stdout).toContain('--batch-name <name>');
    expect(stdout).toContain('Selector modes:');
    expect(stdout).toContain('Resolved: --coffee-id <id> --batch-name <name>');
  }, 15000);

  it('rejects missing all selectors before auth', () => {
    const result = runCli(['sales', 'record', '--oz', '12', '--price', '18', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
    });
    expect(stderr.message).toContain('Missing sale target');
  }, 15000);

  it.each(['12.5abc', '10oz'])(
    'rejects suffixed --oz input %j before auth',
    (oz) => {
      const result = runCli([
        'sales',
        'record',
        '--roast-id',
        '7',
        '--oz',
        oz,
        '--price',
        '18',
        '--json',
      ]);
      const stderr = parseJson(result.stderr);

      expect(result.status).toBe(2);
      expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
      expect(stderr.message).toContain(`Invalid --oz: "${oz}"`);
    },
    15000
  );

  it('rejects incomplete resolved mode when batch-name is missing', () => {
    const result = runCli([
      'sales',
      'record',
      '--coffee-id',
      '7',
      '--oz',
      '12',
      '--price',
      '18',
      '--json',
    ]);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr.message).toContain('Missing --batch-name');
  }, 15000);

  it('rejects incomplete resolved mode when coffee-id is missing', () => {
    const result = runCli([
      'sales',
      'record',
      '--batch-name',
      'Batch A',
      '--oz',
      '12',
      '--price',
      '18',
      '--json',
    ]);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr.message).toContain('Missing --coffee-id');
  }, 15000);

  it('rejects mixing exact and resolved selectors before auth', () => {
    const result = runCli([
      'sales',
      'record',
      '--roast-id',
      '42',
      '--coffee-id',
      '7',
      '--batch-name',
      'Batch A',
      '--oz',
      '12',
      '--price',
      '18',
      '--json',
    ]);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr.message).toContain('Use either --roast-id or --coffee-id + --batch-name');
  }, 15000);

  it('rejects partially numeric resolved selector IDs before auth', () => {
    const result = runCli([
      'sales',
      'record',
      '--coffee-id',
      '7abc',
      '--batch-name',
      'Batch A',
      '--oz',
      '12',
      '--price',
      '18',
      '--json',
    ]);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr.message).toContain('Invalid --coffee-id');
  }, 15000);

  it('does not auto-enter form mode for complete resolved selectors when form-mode=true', () => {
    const result = runCli(
      [
        'sales',
        'record',
        '--coffee-id',
        '7',
        '--batch-name',
        'Batch A',
        '--oz',
        '12',
        '--price',
        '18',
        '--json',
      ],
      { formMode: true }
    );

    expect(result.error).toBeUndefined();
    const stderr = parseJson(result.stderr);
    expect(result.status).toBe(3);
    expect(stderr.code).toBe('AUTH_ERROR');
  }, 15000);
});
