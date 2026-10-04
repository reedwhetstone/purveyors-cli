import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createOptionalParchmentClient: vi.fn() };
});
vi.mock('../src/lib/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/output.js')>();
  return { ...actual, info: vi.fn(), outputData: vi.fn() };
});

import { buildMarketCommand } from '../src/commands/market.js';
import { createOptionalParchmentClient } from '../src/lib/parchment.js';
import { outputData } from '../src/lib/output.js';
import { getCliManifest } from '../src/lib/manifest.js';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });

async function run(...args: string[]) {
  const command = buildMarketCommand();
  command.exitOverride();
  await command.parseAsync(['node', 'market', ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('market metadata dimensions', () => {
  it.each([
    ['variety', 'cultivar'],
    ['drying', 'drying'],
    ['score', 'purveyor_score'],
    ['process', 'process'],
  ])('sends --dimension %s as %s', async (flag, dimension) => {
    const envelope = { data: [], meta: { bucketSemantics: 'overlapping' } };
    const metadataIndex = vi.fn().mockResolvedValue(ok(envelope));
    vi.mocked(createOptionalParchmentClient).mockResolvedValue({
      market: { metadataIndex },
    } as never);
    await run('metadata', '--dimension', flag, '--market', 'all');
    expect(metadataIndex).toHaveBeenCalledWith({ dimension, market: 'all' });
    // The response, including bucketSemantics, is printed unchanged.
    expect(vi.mocked(outputData).mock.calls[0]?.[0]).toEqual(envelope);
  });

  it('documents the two dimensions and that their shares overlap', () => {
    const command = getCliManifest()
      .commandGroups.find((group) => group.name === 'market')
      ?.subcommands?.find((candidate) => candidate.name === 'metadata');
    expect(command?.options?.[0]?.flags).toBe(
      '--dimension <process|disclosure|score|variety|drying>'
    );
    expect(command?.notes?.join(' ')).toContain('these shares overlap');
    expect(command?.notes?.join(' ')).not.toContain('not available yet');
  });
});
