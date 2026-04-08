import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { EXIT_CODES } from '../src/lib/errors.js';
import { getCliManifest, renderContextText } from '../src/lib/manifest.js';
import { createProgram } from '../src/program.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function findCommand(command: Command, path: string[]): Command {
  let current = command;

  for (const segment of path) {
    const next = current.commands.find((candidate) => candidate.name() === segment);
    if (!next) {
      throw new Error(`Command not found: ${path.join(' ')}`);
    }
    current = next;
  }

  return current;
}

function longFlag(flags: string): string {
  const match = flags.match(/--[a-z0-9-]+/i);
  if (!match) {
    throw new Error(`No long flag found in: ${flags}`);
  }
  return match[0];
}

describe('CLI manifest contract', () => {
  it('is JSON-serializable and includes core sections', () => {
    const manifest = getCliManifest();
    const serialized = JSON.stringify(manifest);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed.schemaVersion).toBe('1');
    expect(parsed.binary).toBe('purvey');
    expect(parsed.packageName).toBe('@purveyors/cli');
    expect(Array.isArray(parsed.commandGroups)).toBe(true);
    expect(Array.isArray(parsed.exitCodes)).toBe(true);
    expect(Array.isArray(parsed.idTypes)).toBe(true);
  });

  it('covers drift-prone command capabilities in the manifest', () => {
    const manifest = getCliManifest();
    const commands = Object.fromEntries(
      manifest.commandGroups.flatMap((group) =>
        group.subcommands.map((command) => [`${group.name} ${command.name}`, command])
      )
    );

    expect(commands['catalog search'].options?.map((option) => option.flags)).toEqual(
      expect.arrayContaining(['--variety <text>', '--drying-method <text>', '--stocked-days <n>'])
    );
    expect(commands['inventory list'].options?.map((option) => option.flags)).toContain(
      '--offset <n>'
    );
    expect(commands['roast list'].options?.map((option) => option.flags)).toEqual(
      expect.arrayContaining(['--date-start <YYYY-MM-DD>', '--date-end <YYYY-MM-DD>'])
    );
    expect(commands['sales list'].options?.map((option) => option.flags)).toContain('--offset <n>');
  });

  it('keeps representative manifest options in parity with commander definitions', () => {
    const manifest = getCliManifest();
    const program = createProgram('0.12.0-test');

    const parityChecks = [
      { path: ['catalog', 'search'], flags: ['--variety', '--drying-method', '--stocked-days'] },
      { path: ['inventory', 'list'], flags: ['--offset'] },
      { path: ['roast', 'list'], flags: ['--date-start', '--date-end'] },
      { path: ['sales', 'list'], flags: ['--offset'] },
    ];

    for (const check of parityChecks) {
      const command = findCommand(program, check.path);
      const actualFlags = new Set(command.options.map((option) => option.long));
      const manifestCommand = manifest.commandGroups
        .find((group) => group.name === check.path[0])
        ?.subcommands.find((subcommand) => subcommand.name === check.path[1]);

      expect(manifestCommand).toBeDefined();
      const manifestFlags = new Set(
        (manifestCommand?.options ?? []).map((option) => longFlag(option.flags))
      );

      for (const flag of check.flags) {
        expect(
          actualFlags.has(flag),
          `${check.path.join(' ')} missing commander flag ${flag}`
        ).toBe(true);
        expect(
          manifestFlags.has(flag),
          `${check.path.join(' ')} missing manifest flag ${flag}`
        ).toBe(true);
      }
    }
  });

  it('references the shared exit code contract', () => {
    const manifest = getCliManifest();
    expect(manifest.exitCodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exitCode: EXIT_CODES.OK, code: 'OK' }),
        expect.objectContaining({
          exitCode: EXIT_CODES.INVALID_ARGUMENT,
          code: 'INVALID_ARGUMENT',
        }),
        expect.objectContaining({ exitCode: EXIT_CODES.AUTH_ERROR, code: 'AUTH_ERROR' }),
        expect.objectContaining({ exitCode: EXIT_CODES.NOT_FOUND, code: 'NOT_FOUND' }),
        expect.objectContaining({
          exitCode: EXIT_CODES.DEPENDENCY_CONFLICT,
          code: 'DEPENDENCY_CONFLICT',
        }),
        expect.objectContaining({ exitCode: EXIT_CODES.CONFIG_ERROR, code: 'CONFIG_ERROR' }),
      ])
    );
  });

  it('renders a human-readable context document from manifest data', () => {
    const text = renderContextText();

    expect(text).toContain('PURVEY CLI - Agent Reference');
    expect(text).toContain('catalog');
    expect(text).toContain('--stocked-days <n>');
    expect(text).toContain(
      'Use `purvey context --json` for the machine-readable manifest contract.'
    );
  });

  it('emits valid JSON from `purvey context --json`', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'context', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(stripAnsi(result.stdout).trim()) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe('1');
    expect(manifest.binary).toBe('purvey');
    expect(manifest.commandGroups).toBeDefined();
  }, 15000);

  it('keeps `purvey context` human-readable by default', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'context'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toContain('PURVEY CLI - Agent Reference');
    expect(output).toContain('WORKFLOWS');
    expect(output.trim().startsWith('{')).toBe(false);
  }, 15000);
});
