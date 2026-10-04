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
import { getCliManifest } from '../src/lib/manifest.js';
import {
  getCatalogFacets,
  listCatalogFacets,
  listCatalogTaxonomies,
  searchCatalog,
} from '../src/lib/catalog.js';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });

async function run(...args: string[]) {
  const command = buildCatalogCommand();
  command.exitOverride();
  await command.parseAsync(['node', 'catalog', ...args]);
}

const entry = (code: string, label: string, parent_code: string | null, aliases: string[]) => ({
  code,
  label,
  parent_code,
  description: null,
  active: true,
  sort_order: 0,
  aliases,
});

const VOCABULARY = {
  data: {
    varieties: [
      { ...entry('bourbon', 'Bourbon', null, ['bourbon', 'borbon']), species_code: 'arabica' },
      {
        ...entry('pink_bourbon', 'Pink Bourbon', 'bourbon', ['pink bourbon']),
        species_code: 'arabica',
      },
      { ...entry('gesha', 'Gesha', null, ['gesha', 'geisha']), species_code: 'arabica' },
    ],
    species: [entry('canephora', 'Robusta (C. canephora)', null, ['canephora', 'robusta'])],
    drying_methods: [
      entry('raised_bed', 'Raised beds', null, ['raised beds']),
      entry('african_bed', 'African beds', 'raised_bed', ['african beds']),
    ],
  },
  meta: { resource: 'catalog-taxonomies' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('taxonomy code search', () => {
  it('forwards code filters and lets Parchment validate and gate them', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await searchCatalog({
      variety: 'pink',
      varietyCodes: ['bourbon', 'gesha'],
      speciesCodes: ['canephora'],
      dryingMethodCodes: ['raised_bed'],
    });
    expect(createParchmentClient).toHaveBeenCalledWith('viewer');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        variety: 'pink',
        varietyCode: ['bourbon', 'gesha'],
        speciesCode: ['canephora'],
        dryingMethodCode: ['raised_bed'],
      })
    );
  });

  it('parses comma-separated flags, lowercasing them', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [{ id: 1 }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await run('search', '--variety-code', 'Bourbon, gesha', '--drying-method-code', 'patio');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ varietyCode: ['bourbon', 'gesha'], dryingMethodCode: ['patio'] })
    );
    expect(list.mock.calls[0]?.[0]).not.toHaveProperty('speciesCode', expect.anything());
  });

  it('rejects malformed codes before any request', async () => {
    const list = vi.fn();
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const args of [
      ['search', '--variety-code', 'Pink Bourbon'],
      ['search', '--species-code', ','],
      ['search', '--drying-method-code', 'raised-bed'],
    ]) {
      await run(...args).catch(() => undefined);
      expect(list).not.toHaveBeenCalled();
    }
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('taxonomy facets', () => {
  it('requests taxonomy facets only for code fields', async () => {
    const facets = vi
      .fn()
      .mockResolvedValue(
        ok({ facets: { varieties: [{ value: 'bourbon', count: 12 }] }, values: {}, meta: {} })
      );
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);
    const result = await listCatalogFacets({ field: 'varieties' });
    expect(facets).toHaveBeenCalledWith({ stocked: 'true', include: 'taxonomy' });
    expect(result).toMatchObject({
      field: 'varieties',
      facet: 'varieties',
      data: [{ value: 'bourbon', count: 12 }],
    });

    await listCatalogFacets({ field: 'country', stockedOnly: false });
    expect(facets).toHaveBeenLastCalledWith({ stocked: 'all' });
  });

  it('requests grading and taxonomy facets together when both are asked for', async () => {
    const facets = vi.fn().mockResolvedValue(ok({ facets: {}, values: {}, meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);

    await getCatalogFacets({ includeGrading: true, includeTaxonomy: true });
    expect(facets).toHaveBeenLastCalledWith({ stocked: 'true', include: 'grading,taxonomy' });

    await getCatalogFacets({ includeGrading: true });
    expect(facets).toHaveBeenLastCalledWith({ stocked: 'true', include: 'grading' });

    await getCatalogFacets({ includeTaxonomy: true });
    expect(facets).toHaveBeenLastCalledWith({ stocked: 'true', include: 'taxonomy' });

    await getCatalogFacets();
    expect(facets).toHaveBeenLastCalledWith({ stocked: 'true' });
  });

  it('describes the no-field example as omitting grading and code facets', () => {
    let help = '';
    const command = buildCatalogCommand().commands.find((entry) => entry.name() === 'facets');
    command?.configureOutput({ writeOut: (text) => (help += text) });
    command?.outputHelp();
    expect(help).toContain('# every facet except the grading and code facets');
    expect(help).not.toContain('non-grading');
  });
});

describe('catalog taxonomies', () => {
  it('resolves a typed name through labels and supplier spellings', async () => {
    const taxonomies = vi.fn().mockResolvedValue(ok(VOCABULARY));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { taxonomies } } as never);

    const geisha = await listCatalogTaxonomies({ search: 'Geisha' });
    expect(geisha.data.varieties.map((v) => v.code)).toEqual(['gesha']);
    expect(geisha.data.species).toEqual([]);
    expect(geisha.meta).toEqual(VOCABULARY.meta);

    const robusta = await listCatalogTaxonomies({ search: 'robusta' });
    expect(robusta.data.species.map((s) => s.code)).toEqual(['canephora']);

    const beds = await listCatalogTaxonomies({ search: 'African  beds' });
    expect(beds.data.drying_methods.map((d) => d.code)).toEqual(['african_bed']);
    expect(taxonomies).toHaveBeenCalledWith({});
    expect(createParchmentClient).toHaveBeenCalledWith('viewer');
  });

  it('lists a family with the codes under it and limits to one vocabulary', async () => {
    const taxonomies = vi.fn().mockResolvedValue(ok(VOCABULARY));
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { taxonomies } } as never);
    await run('taxonomies', '--taxonomy', 'variety', '--family', 'Bourbon', '--include-retired');
    expect(taxonomies).toHaveBeenCalledWith({ includeRetired: 'true' });
    const printed = vi.mocked(outputData).mock.calls[0]?.[0] as typeof VOCABULARY;
    expect(printed.data.varieties.map((v) => v.code)).toEqual(['bourbon', 'pink_bourbon']);
    expect(printed.data.species).toEqual([]);
    expect(printed.data.drying_methods).toEqual([]);
  });

  it('rejects an unknown vocabulary name', async () => {
    const taxonomies = vi.fn();
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { taxonomies } } as never);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await run('taxonomies', '--taxonomy', 'cultivar').catch(() => undefined);
    expect(taxonomies).not.toHaveBeenCalled();
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('is declared in the manifest against the SDK method it calls', () => {
    const command = getCliManifest()
      .commandGroups.find((group) => group.name === 'catalog')
      ?.subcommands?.find((candidate) => candidate.name === 'taxonomies');
    expect(command?.sdkMethods).toEqual(['catalog.taxonomies']);
    expect(command?.options?.map((option) => option.flags)).toEqual([
      '--taxonomy <name>',
      '--family <code>',
      '--include-retired',
    ]);
  });
});
