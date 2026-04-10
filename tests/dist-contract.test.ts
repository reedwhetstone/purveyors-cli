import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function run(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parseJsonStdout(result: SpawnSyncReturns<string>) {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(stripAnsi(result.stdout).trim()) as Record<string, unknown>;
}

describe('compiled dist artifact parity', () => {
  it('keeps dist help aligned with the machine-readable onboarding surface', () => {
    const distHelpResult = run('node', ['dist/index.js', '--help']);
    const sourceHelpResult = run('pnpm', ['exec', 'tsx', 'src/index.ts', '--help']);

    expect(distHelpResult.status).toBe(0);
    expect(distHelpResult.stderr).toBe('');
    expect(sourceHelpResult.status).toBe(0);
    expect(sourceHelpResult.stderr).toBe('');

    const distHelp = stripAnsi(distHelpResult.stdout);
    const sourceHelp = stripAnsi(sourceHelpResult.stdout);

    for (const snippet of [
      'manifest',
      'Human reference:  purvey context',
      'JSON manifest:    purvey manifest',
    ]) {
      expect(distHelp).toContain(snippet);
      expect(sourceHelp).toContain(snippet);
    }
  }, 15000);

  it('emits valid JSON from dist manifest and keeps it in parity with source manifest', () => {
    const distManifest = parseJsonStdout(run('node', ['dist/index.js', 'manifest']));
    const sourceManifest = parseJsonStdout(
      run('pnpm', ['exec', 'tsx', 'src/index.ts', 'manifest'])
    );

    expect(distManifest).toEqual(sourceManifest);
    expect(distManifest.commandGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'context' }),
        expect.objectContaining({ name: 'manifest' }),
      ])
    );
  }, 15000);

  it('keeps dist context --json in parity with both source entrypoints', () => {
    const distContext = parseJsonStdout(run('node', ['dist/index.js', 'context', '--json']));
    const sourceContext = parseJsonStdout(
      run('pnpm', ['exec', 'tsx', 'src/index.ts', 'context', '--json'])
    );
    const sourceManifest = parseJsonStdout(
      run('pnpm', ['exec', 'tsx', 'src/index.ts', 'manifest'])
    );

    expect(distContext).toEqual(sourceContext);
    expect(distContext).toEqual(sourceManifest);
  }, 15000);
});
