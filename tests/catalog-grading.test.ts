import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/auth-guard.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn(), resolveParchmentToken: vi.fn() };
});
vi.mock('../src/lib/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/output.js')>();
  return { ...actual, info: vi.fn(), outputData: vi.fn() };
});

import { buildCatalogCommand } from '../src/commands/catalog.js';
import { createParchmentClient } from '../src/lib/parchment.js';
import { outputData } from '../src/lib/output.js';
import {
  compareCatalog,
  getCatalogPriceHistory,
  listCatalogFacets,
  listCatalogGrades,
  searchCatalog,
} from '../src/lib/catalog.js';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });

async function run(...args: string[]) {
  const command = buildCatalogCommand();
  command.exitOverride();
  await command.parseAsync(['node', 'catalog', ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('grading search', () => {
  it('forwards grading filters and uses the member credential', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await searchCatalog({
      gradeCodes: ['KE:AA', 'KE:AB'],
      gradeDimension: 'size',
      screenMin: 17,
      elevationMin: 1600,
      peaberry: true,
      labAnalyzed: true,
      moistureMax: 11,
      scoreProtocol: 'sca_2004',
    });
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        gradeCode: ['KE:AA', 'KE:AB'],
        gradeDimension: 'size',
        screenMin: 17,
        elevationMinMasl: 1600,
        peaberry: 'true',
        labAnalyzed: 'true',
        moistureMax: 11,
        scoreProtocol: 'sca_2004',
      })
    );
  });

  it('parses grading flags from the command line and rejects bad values', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [{ id: 1 }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await run(
      'search',
      '--grade',
      'ke:aa, PREP:EP',
      '--screen-min',
      '17',
      '--grade-kind',
      'altitude'
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        gradeCode: ['KE:AA', 'PREP:EP'],
        screenMin: 17,
        gradeDimension: 'altitude',
      })
    );

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const args of [
      ['search', '--grade', 'not-a-code'],
      ['search', '--screen-min', '25'],
      ['search', '--grade-kind', 'flavor'],
      ['search', '--score-protocol', 'points'],
    ]) {
      list.mockClear();
      await run(...args).catch(() => undefined);
      expect(list).not.toHaveBeenCalled();
    }
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('grading facets', () => {
  it('requests grading facets only for grading fields', async () => {
    const facets = vi
      .fn()
      .mockResolvedValue(
        ok({ facets: { grade_altitude: [{ value: 'GT:SHB', count: 3 }] }, values: {}, meta: {} })
      );
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);
    const result = await listCatalogFacets({ field: 'grade_altitude' });
    expect(facets).toHaveBeenCalledWith({ stocked: 'true', include: 'grading' });
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(result.data).toEqual([{ value: 'GT:SHB', count: 3 }]);
  });
});

describe('compare, price history, and grades', () => {
  it('compares distinct ids at a quantity', async () => {
    const compare = vi.fn().mockResolvedValue(ok({ data: { rows: [] } }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { compare } } as never);
    await run('compare', '416', '8806,1182', '--quantity', '5');
    expect(compare).toHaveBeenCalledWith({ ids: '416,8806,1182', quantityLbs: '5' });
    expect(outputData).toHaveBeenCalled();
    await expect(compareCatalog({ ids: [416, 416] })).rejects.toThrow('distinct');
  });

  it('reads price history with the member credential', async () => {
    const priceHistory = vi.fn().mockResolvedValue(ok({ data: { points: [] } }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { priceHistory } } as never);
    await getCatalogPriceHistory({ id: 1182, days: 90 });
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(priceHistory).toHaveBeenCalledWith('1182', { days: '90' });
  });

  it('filters the grade vocabulary and reports unknown codes', async () => {
    const designation = (code: string, dimensions: string[]) => ({
      code,
      system: code.split(':')[0],
      dimensions,
      label: code,
    });
    const grades = vi.fn().mockResolvedValue(
      ok({
        data: [designation('KE:AA', ['size']), designation('ET:G1', ['defects', 'cup'])],
        meta: { resource: 'catalog-grades' },
      })
    );
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { grades } } as never);
    const byCode = await listCatalogGrades({ codes: ['ke:aa', 'XX:NOPE'] });
    expect(byCode.data.map((d) => d.code)).toEqual(['KE:AA']);
    expect(byCode.unknownCodes).toEqual(['XX:NOPE']);
    const byKind = await listCatalogGrades({ dimension: 'cup' });
    expect(byKind.data.map((d) => d.code)).toEqual(['ET:G1']);
    expect(grades).toHaveBeenCalledWith({});
  });
});
