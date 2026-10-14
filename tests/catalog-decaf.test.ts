import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});
vi.mock('../src/lib/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/output.js')>();
  return { ...actual, outputData: vi.fn() };
});

import { buildCatalogCommand } from '../src/commands/catalog.js';
import { createParchmentClient } from '../src/lib/parchment.js';
import { outputData } from '../src/lib/output.js';
import { AuthError } from '../src/lib/errors.js';
import {
  computeSupplierAggregates,
  getCatalogFacets,
  listCatalogFacets,
  searchCatalog,
} from '../src/lib/catalog.js';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });

async function run(...args: string[]) {
  const command = buildCatalogCommand();
  command.exitOverride();
  await command.parseAsync(['node', 'catalog', ...args]);
}

beforeEach(() => vi.clearAllMocks());

describe('decaf catalog queries', () => {
  it.each([true, false, undefined])(
    'forwards decaf=%s without changing farm process',
    async (decaf) => {
      const rows = [
        {
          id: 1,
          decaffeinated: true,
          decafMethod: { code: 'swiss_water', label: 'Swiss Water' },
          processing_base_method: 'Natural',
        },
      ];
      const list = vi.fn().mockResolvedValue(ok({ data: rows }));
      vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);

      expect(await searchCatalog({ decaf, processingBaseMethod: 'Natural' })).toBe(rows);
      expect(createParchmentClient).toHaveBeenCalledWith('viewer');
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          decaf: decaf === undefined ? undefined : String(decaf),
          processing_base_method: 'Natural',
        })
      );
    }
  );

  it.each(['true', 'false'])(
    'parses --decaf %s as a boolean, not a truthy string',
    async (value) => {
      const list = vi.fn().mockResolvedValue(ok({ data: [] }));
      vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
      await run('search', '--decaf', value);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ decaf: value }));
    }
  );

  it.each([401, 403])('preserves Parchment access denial %s for filtered reads', async (status) => {
    const list = vi.fn().mockResolvedValue({
      error: { message: 'Catalog access denied' },
      response: new Response(null, { status }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await expect(searchCatalog({ decaf: true })).rejects.toBeInstanceOf(AuthError);
    expect(createParchmentClient).toHaveBeenCalledWith('viewer');
  });

  it('rejects string booleans from in-process callers before creating a client', async () => {
    await expect(searchCatalog({ decaf: 'false' as never })).rejects.toThrow();
    await expect(getCatalogFacets({ decaf: 'false' as never })).rejects.toThrow();
    await expect(listCatalogFacets({ field: 'decaf', decaf: 'false' as never })).rejects.toThrow();
    expect(createParchmentClient).not.toHaveBeenCalled();
  });
});

describe('decaf facet discovery', () => {
  const envelope = {
    facets: {
      decaf: [
        { value: 'true', count: 272 },
        { value: 'false', count: 2900 },
      ],
    },
    values: { decaf: ['true', 'false'] },
    meta: { access: { canUseProcessFacets: true } },
  };

  it.each([true, false, undefined])(
    'forwards decaf=%s and preserves canonical counts',
    async (decaf) => {
      const facets = vi.fn().mockResolvedValue(ok(envelope));
      vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);

      expect(await getCatalogFacets({ decaf })).toBe(envelope);
      expect(facets).toHaveBeenLastCalledWith({
        stocked: 'true',
        ...(decaf === undefined ? {} : { decaf: String(decaf) }),
      });
      expect(await listCatalogFacets({ field: 'decaf', decaf, stockedOnly: false })).toEqual({
        field: 'decaf',
        facet: 'decaf',
        data: envelope.facets.decaf,
        meta: envelope.meta,
      });
      expect(facets).toHaveBeenLastCalledWith({
        stocked: 'all',
        ...(decaf === undefined ? {} : { decaf: String(decaf) }),
      });
    }
  );

  it.each(['true', 'false'])(
    'wires filtered whole-envelope and named CLI facets for %s',
    async (value) => {
      const facets = vi.fn().mockResolvedValue(ok(envelope));
      vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);
      await run('facets', '--decaf', value);
      expect(outputData).toHaveBeenLastCalledWith(envelope, expect.anything());
      await run('facets', 'decaf', '--decaf', value, '--all');
      expect(facets).toHaveBeenLastCalledWith({ stocked: 'all', decaf: value });
      expect(outputData).toHaveBeenLastCalledWith(
        { field: 'decaf', facet: 'decaf', data: envelope.facets.decaf, meta: envelope.meta },
        expect.anything()
      );
    }
  );
});

describe('SDK-derived optional catalog fields', () => {
  it('does not count missing confidence or unknown price payloads as disclosed data', () => {
    const [supplier] = computeSupplierAggregates([{ id: 1, price_tiers: { unknown: true } }]);
    expect(supplier.score.average_confidence).toBeNull();
    expect(supplier.score.confidence_coverage).toBe(0);
    expect(supplier.price.average_per_lb).toBeNull();
    expect(supplier.top_coffees[0]).toMatchObject({
      name: null,
      supplier: null,
      origin: { country: null },
      stocked: null,
    });
  });
});
