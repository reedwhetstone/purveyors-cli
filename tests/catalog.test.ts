import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/auth-guard.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../src/lib/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/output.js')>();
  return {
    ...actual,
    info: vi.fn(),
    outputData: vi.fn(),
  };
});

import { buildCatalogCommand } from '../src/commands/catalog.js';
import { requireAuth } from '../src/lib/auth-guard.js';
import {
  computeCatalogStats,
  searchCatalog,
  getCatalog,
  getCatalogSimilarity,
  getCatalogSimilaritySchema,
  searchCatalogSchema,
  sanitizeFilterValue,
  findSimilarBeansSchema,
  findSimilarBeans,
} from '../src/lib/catalog.js';
import { outputData } from '../src/lib/output.js';
import type { CatalogItem, CatalogSimilarityResponse, SimilarBean } from '../src/lib/catalog.js';
import type { SupabaseClient } from '@supabase/supabase-js';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PARCHMENT_API_KEY;
  delete process.env.PURVEYORS_API_KEY;
  delete process.env.PURVEYORS_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Minimal factory so tests are readable without full item payloads
function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 1,
    name: 'Test Coffee',
    source: 'Test Roaster',
    continent: 'Africa',
    country: 'Ethiopia',
    region: null,
    processing: 'natural',
    processing_base_method: null,
    fermentation_type: null,
    process_additives: null,
    process_additive_detail: null,
    fermentation_duration_hours: null,
    processing_notes: null,
    processing_disclosure_level: null,
    processing_confidence: null,
    processing_evidence_available: null,
    drying_method: null,
    cultivar_detail: null,
    grade: null,
    appearance: null,
    type: null,
    description_short: null,
    description_long: null,
    farm_notes: null,
    cupping_notes: null,
    ai_description: null,
    roast_recs: null,
    cost_lb: 12.0,
    price_per_lb: 12.0,
    price_tiers: [{ min_lbs: 1, price: 12.0 }],
    lot_size: null,
    bag_size: null,
    score_value: null,
    stocked: true,
    stocked_date: null,
    unstocked_date: null,
    arrival_date: null,
    last_updated: null,
    public_coffee: true,
    wholesale: false,
    ...overrides,
  };
}

function makeProof() {
  return {
    version: 'proof-summary-v1',
    overall: { label: 'partial', families_with_signals: 2 },
    families: {
      process: {
        label: 'disclosed',
        confidence: 0.8,
        signals: ['structured_process'],
        message: 'Structured process disclosure signals are present.',
      },
    },
    limitations: ['not_certification'],
  };
}

function makeCanonicalSimilarityResponse(
  overrides: Partial<CatalogSimilarityResponse> = {}
): CatalogSimilarityResponse {
  const proof = makeProof();
  const candidate = {
    coffee: {
      id: 1199,
      name: 'Sibling Lot',
      source: 'Royal Coffee',
      origin: 'Ethiopia',
      country: 'Ethiopia',
      continent: 'Africa',
      processing: 'natural',
      processing_base_method: 'Natural',
      fermentation_type: null,
      drying_method: 'raised bed',
      stocked: true,
      arrival_date: null,
      stocked_date: '2026-05-01',
      proof,
    },
    pricing: {
      price_per_lb: 9.5,
      price_tiers: [{ min_lbs: 1, price: 9.5 }],
      cost_lb: 9.5,
      baseline_quantity_lbs: 1 as const,
      baseline_price_per_lb: 9.5,
      baseline_source: 'price_per_lb' as const,
    },
    price_delta_1lb: { amount: 1, percent: 11.8, currency: 'USD' as const },
    score: {
      average: 0.91,
      dimensions: { origin: 0.98, processing: 0.94, tasting: 0.82 },
      chunk_matches: 3,
    },
    match: {
      category: 'likely_same' as const,
      classification: {
        kind: 'canonical_candidate' as const,
        identity_eligibility: 'eligible' as const,
        confidence: 'high_beta' as const,
        blockers: [],
        evidence: ['same_country', 'same_process'],
      },
      confidence: 'high_beta' as const,
      beta: true as const,
      language: 'Likely same-lot candidate.',
    },
    explanation: { summary: 'Strong overlap across origin and processing.', signals: ['origin'] },
    compatibility: { cost_lb: 9.5 },
  };

  const response: CatalogSimilarityResponse = {
    data: {
      target: {
        id: 1182,
        name: 'Target Coffee',
        source: 'Royal Coffee',
        origin: 'Ethiopia',
        country: 'Ethiopia',
        continent: 'Africa',
        processing: 'natural',
        processing_base_method: 'Natural',
        fermentation_type: null,
        drying_method: 'raised bed',
        stocked: true,
        arrival_date: null,
        stocked_date: '2026-04-30',
        price_per_lb: 8.5,
        price_tiers: [{ min_lbs: 1, price: 8.5 }],
        cost_lb: 8.5,
        pricing: {
          price_per_lb: 8.5,
          price_tiers: [{ min_lbs: 1, price: 8.5 }],
          cost_lb: 8.5,
          baseline_quantity_lbs: 1,
          baseline_price_per_lb: 8.5,
          baseline_source: 'price_per_lb',
        },
        proof,
      },
      groups: {
        canonical_candidates: [candidate],
        similar_recommendations: [
          {
            ...candidate,
            coffee: { ...candidate.coffee, id: 1200, name: 'Profile Match' },
            match: {
              ...candidate.match,
              category: 'similar_profile',
              classification: {
                ...candidate.match.classification,
                kind: 'similar_recommendation',
                identity_eligibility: 'blocked',
                blockers: [
                  {
                    code: 'processing_base_method_conflict',
                    severity: 'hard',
                    target_value: 'Natural',
                    candidate_value: 'Washed',
                  },
                ],
              },
            },
          },
        ],
      },
      matches: [candidate],
    },
    meta: {
      resource: 'catalog-similarity',
      namespace: '/v1/catalog/{id}/similar',
      version: 'v1',
      status: 'beta',
      query: { threshold: 0.85, limit: 5, stockedOnly: true, mode: 'likely_same' },
      classification_version: 'canonical-match-v1',
      query_strategy: 'bounded-vector-candidates-v1',
    },
  };

  return { ...response, ...overrides };
}

describe('computeCatalogStats', () => {
  it('returns zeros for an empty list', () => {
    const stats = computeCatalogStats([]);
    expect(stats.total).toBe(0);
    expect(stats.stocked).toBe(0);
    expect(stats.avgPricePerLb).toBeNull();
    expect(stats.byOrigin).toEqual({});
    expect(stats.priceRange).toEqual({ min: null, max: null });
  });

  it('counts total items correctly', () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })];
    expect(computeCatalogStats(items).total).toBe(3);
  });

  it('counts only stocked items', () => {
    const items = [
      makeItem({ id: 1, stocked: true }),
      makeItem({ id: 2, stocked: false }),
      makeItem({ id: 3, stocked: true }),
      makeItem({ id: 4, stocked: null }),
    ];
    expect(computeCatalogStats(items).stocked).toBe(2);
  });

  it('groups items by country', () => {
    const items = [
      makeItem({ id: 1, country: 'Ethiopia' }),
      makeItem({ id: 2, country: 'Ethiopia' }),
      makeItem({ id: 3, country: 'Colombia' }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.byOrigin).toEqual({ Ethiopia: 2, Colombia: 1 });
  });

  it('falls back to continent when country is null', () => {
    const items = [
      makeItem({ id: 1, country: null, continent: 'Asia' }),
      makeItem({ id: 2, country: 'Colombia', continent: 'South America' }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.byOrigin['Asia']).toBe(1);
    expect(stats.byOrigin['Colombia']).toBe(1);
  });

  it('uses "Unknown" when both country and continent are null', () => {
    const items = [makeItem({ id: 1, country: null, continent: null })];
    const stats = computeCatalogStats(items);
    expect(stats.byOrigin['Unknown']).toBe(1);
  });

  it('computes average price per lb', () => {
    const items = [
      makeItem({
        id: 1,
        cost_lb: 10.0,
        price_per_lb: 10.0,
        price_tiers: [{ min_lbs: 1, price: 10.0 }],
      }),
      makeItem({
        id: 2,
        cost_lb: 20.0,
        price_per_lb: 20.0,
        price_tiers: [{ min_lbs: 1, price: 20.0 }],
      }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(15.0);
  });

  it('rounds average price to 2 decimal places', () => {
    const items = [
      makeItem({
        id: 1,
        cost_lb: 10.0,
        price_per_lb: 10.0,
        price_tiers: [{ min_lbs: 1, price: 10.0 }],
      }),
      makeItem({
        id: 2,
        cost_lb: 11.0,
        price_per_lb: 11.0,
        price_tiers: [{ min_lbs: 1, price: 11.0 }],
      }),
      makeItem({
        id: 3,
        cost_lb: 12.0,
        price_per_lb: 12.0,
        price_tiers: [{ min_lbs: 1, price: 12.0 }],
      }),
    ];
    const stats = computeCatalogStats(items);
    // (10 + 11 + 12) / 3 = 11.0
    expect(stats.avgPricePerLb).toBe(11.0);
  });

  it('skips null prices when computing average', () => {
    const items = [
      makeItem({
        id: 1,
        cost_lb: 10.0,
        price_per_lb: 10.0,
        price_tiers: [{ min_lbs: 1, price: 10.0 }],
      }),
      makeItem({ id: 2, cost_lb: null, price_per_lb: null, price_tiers: null }),
      makeItem({
        id: 3,
        cost_lb: 20.0,
        price_per_lb: 20.0,
        price_tiers: [{ min_lbs: 1, price: 20.0 }],
      }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(15.0);
  });

  it('returns null average when all prices are null', () => {
    const items = [
      makeItem({ id: 1, cost_lb: null, price_per_lb: null, price_tiers: null }),
      makeItem({ id: 2, cost_lb: null, price_per_lb: null, price_tiers: null }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBeNull();
  });

  it('computes price range correctly', () => {
    const items = [
      makeItem({
        id: 1,
        cost_lb: 8.5,
        price_per_lb: 8.5,
        price_tiers: [{ min_lbs: 1, price: 8.5 }],
      }),
      makeItem({
        id: 2,
        cost_lb: 25.0,
        price_per_lb: 25.0,
        price_tiers: [{ min_lbs: 1, price: 25.0 }],
      }),
      makeItem({
        id: 3,
        cost_lb: 15.0,
        price_per_lb: 15.0,
        price_tiers: [{ min_lbs: 1, price: 15.0 }],
      }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.priceRange.min).toBe(8.5);
    expect(stats.priceRange.max).toBe(25.0);
  });

  it('returns null price range when no items have prices', () => {
    const items = [makeItem({ id: 1, cost_lb: null, price_per_lb: null, price_tiers: null })];
    const stats = computeCatalogStats(items);
    expect(stats.priceRange.min).toBeNull();
    expect(stats.priceRange.max).toBeNull();
  });

  it('prefers price_tiers[0].price over price_per_lb and cost_lb', () => {
    const items = [
      makeItem({
        id: 1,
        cost_lb: 10.0,
        price_per_lb: 12.0,
        price_tiers: [{ min_lbs: 1, price: 15.0 }],
      }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(15.0);
  });

  it('falls back to price_per_lb when price_tiers is null', () => {
    const items = [makeItem({ id: 1, cost_lb: 10.0, price_per_lb: 12.0, price_tiers: null })];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(12.0);
  });

  it('falls back to cost_lb when price_tiers and price_per_lb are null', () => {
    const items = [makeItem({ id: 1, cost_lb: 10.0, price_per_lb: null, price_tiers: null })];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(10.0);
  });
});

describe('searchCatalogSchema', () => {
  it('accepts name as optional string', () => {
    const result = searchCatalogSchema.parse({ name: 'Guji' });
    expect(result.name).toBe('Guji');
  });

  it('accepts supplier as optional string', () => {
    const result = searchCatalogSchema.parse({ supplier: 'Royal Coffee' });
    expect(result.supplier).toBe('Royal Coffee');
  });

  it('accepts ids as array of positive integers', () => {
    const result = searchCatalogSchema.parse({ ids: [1, 2, 100] });
    expect(result.ids).toEqual([1, 2, 100]);
  });

  it('rejects ids with non-integer values', () => {
    expect(() => searchCatalogSchema.parse({ ids: [1.5] })).toThrow();
  });

  it('rejects ids with non-positive values', () => {
    expect(() => searchCatalogSchema.parse({ ids: [0] })).toThrow();
    expect(() => searchCatalogSchema.parse({ ids: [-1] })).toThrow();
  });

  it('rejects ids array exceeding max of 100', () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(() => searchCatalogSchema.parse({ ids: tooMany })).toThrow();
  });

  it('accepts ids array at max boundary of 100', () => {
    const atMax = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = searchCatalogSchema.parse({ ids: atMax });
    expect(result.ids).toHaveLength(100);
  });

  it('allows all new fields to be omitted', () => {
    const result = searchCatalogSchema.parse({});
    expect(result.name).toBeUndefined();
    expect(result.supplier).toBeUndefined();
    expect(result.ids).toBeUndefined();
  });

  it('combines new fields with existing fields', () => {
    const result = searchCatalogSchema.parse({
      origin: 'Ethiopia',
      name: 'Guji',
      supplier: 'Royal',
      stocked: true,
    });
    expect(result.origin).toBe('Ethiopia');
    expect(result.name).toBe('Guji');
    expect(result.supplier).toBe('Royal');
    expect(result.stocked).toBe(true);
  });

  it('applies default limit when not provided', () => {
    const result = searchCatalogSchema.parse({ ids: [1, 2, 3] });
    expect(result.limit).toBe(10);
  });

  it('accepts variety as optional string', () => {
    const result = searchCatalogSchema.parse({ variety: 'gesha' });
    expect(result.variety).toBe('gesha');
  });

  it('accepts dryingMethod as optional string', () => {
    const result = searchCatalogSchema.parse({ dryingMethod: 'sun dried' });
    expect(result.dryingMethod).toBe('sun dried');
  });

  it('accepts stockedDays as positive integer', () => {
    const result = searchCatalogSchema.parse({ stockedDays: 30 });
    expect(result.stockedDays).toBe(30);
  });

  it('rejects stockedDays of 0', () => {
    expect(() => searchCatalogSchema.parse({ stockedDays: 0 })).toThrow();
  });

  it('rejects negative stockedDays', () => {
    expect(() => searchCatalogSchema.parse({ stockedDays: -5 })).toThrow();
  });

  it('rejects non-integer stockedDays', () => {
    expect(() => searchCatalogSchema.parse({ stockedDays: 7.5 })).toThrow();
  });

  it('allows variety, dryingMethod, and stockedDays to be omitted', () => {
    const result = searchCatalogSchema.parse({});
    expect(result.variety).toBeUndefined();
    expect(result.dryingMethod).toBeUndefined();
    expect(result.stockedDays).toBeUndefined();
  });

  it('accepts includeProof as an opt-in flag', () => {
    const result = searchCatalogSchema.parse({ includeProof: true });
    expect(result.includeProof).toBe(true);
  });

  it('accepts structured process filters', () => {
    const result = searchCatalogSchema.parse({
      processingBaseMethod: 'Natural',
      fermentationType: 'Anaerobic',
      processAdditive: 'hops',
      processingDisclosureLevel: 'high_detail',
      processingConfidenceMin: 0.8,
    });

    expect(result.processingBaseMethod).toBe('Natural');
    expect(result.fermentationType).toBe('Anaerobic');
    expect(result.processAdditive).toBe('hops');
    expect(result.processingDisclosureLevel).toBe('high_detail');
    expect(result.processingConfidenceMin).toBe(0.8);
  });

  it('rejects process confidence thresholds outside 0-1', () => {
    expect(() => searchCatalogSchema.parse({ processingConfidenceMin: -0.1 })).toThrow();
    expect(() => searchCatalogSchema.parse({ processingConfidenceMin: 1.1 })).toThrow();
  });

  it('combines variety and dryingMethod with existing fields', () => {
    const result = searchCatalogSchema.parse({
      origin: 'Ethiopia',
      variety: 'heirloom',
      dryingMethod: 'raised bed',
      stocked: true,
      stockedDays: 14,
    });
    expect(result.origin).toBe('Ethiopia');
    expect(result.variety).toBe('heirloom');
    expect(result.dryingMethod).toBe('raised bed');
    expect(result.stocked).toBe(true);
    expect(result.stockedDays).toBe(14);
  });
});

describe('sanitizeFilterValue', () => {
  it('strips PostgREST special characters', () => {
    expect(sanitizeFilterValue('Royal (Coffee)')).toBe('Royal Coffee');
    expect(sanitizeFilterValue('test%value')).toBe('testvalue');
    expect(sanitizeFilterValue('a.b*c')).toBe('abc');
  });

  it('passes clean strings through unchanged', () => {
    expect(sanitizeFilterValue('Ethiopia Guji')).toBe('Ethiopia Guji');
    expect(sanitizeFilterValue('Royal Coffee')).toBe('Royal Coffee');
  });
});

// ─── searchCatalog query mapping ─────────────────────────────────────────────

function makeSearchSupabase(response: { data?: unknown; error?: unknown | null } = {}) {
  const query = {
    data: response.data ?? [],
    error: response.error ?? null,
    or: vi.fn(() => query),
    ilike: vi.fn(() => query),
    eq: vi.fn(() => query),
    contains: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
  };
  const select = vi.fn(() => query);
  const from = vi.fn(() => ({ select }));

  return { supabase: { from } as unknown as SupabaseClient, query, select, from };
}

async function runCatalogCommand(args: string[]): Promise<void> {
  const command = buildCatalogCommand();
  command.exitOverride();
  command.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
    outputError: () => undefined,
  });

  await command.parseAsync(['node', 'catalog', ...args], { from: 'node' });
}

describe('catalog command auth and structured filter parsing', () => {
  it('requires viewer auth for normal catalog search', async () => {
    const { supabase } = makeSearchSupabase();
    vi.mocked(requireAuth).mockResolvedValue({ supabase, userId: 'user-1' });

    await runCatalogCommand(['search', '--origin', 'Ethiopia']);

    expect(requireAuth).toHaveBeenCalledWith('viewer');
  });

  it('uses API-key catalog proof reads without session auth when an API key env is set', async () => {
    process.env.PARCHMENT_API_KEY = 'parchment-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [makeItem()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await runCatalogCommand(['search', '--include-proof']);

    expect(requireAuth).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer parchment-key' }),
      })
    );
  });

  it('uses API-key canonical similarity reads without session auth when an API key env is set', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    process.env.PARCHMENT_API_KEY = 'parchment-key';
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await runCatalogCommand([
      'similar',
      '1182',
      '--threshold',
      '0.85',
      '--limit',
      '5',
      '--stocked-only',
      '--mode',
      'likely_same',
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.origin).toBe('https://example.test');
    expect(requestUrl.pathname).toBe('/v1/catalog/1182/similar');
    expect(requestUrl.searchParams.get('threshold')).toBe('0.85');
    expect(requestUrl.searchParams.get('limit')).toBe('5');
    expect(requestUrl.searchParams.get('stocked_only')).toBe('true');
    expect(requestUrl.searchParams.get('mode')).toBe('likely_same');
    expect(requireAuth).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer parchment-key' }),
      })
    );
    expect(outputData).toHaveBeenCalledWith(response, expect.any(Object));
  });

  it('uses viewer session auth for canonical similarity reads when no API key env is set', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'session-token' } },
        }),
      },
    } as unknown as SupabaseClient;
    vi.mocked(requireAuth).mockResolvedValue({ supabase, userId: 'user-1' });

    await runCatalogCommand(['similar', '1182']);

    expect(requireAuth).toHaveBeenCalledWith('viewer');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      })
    );
    expect(outputData).toHaveBeenCalledWith(response, expect.any(Object));
  });

  it('requires member auth when any structured process filter is requested', async () => {
    const structuredFlags = [
      ['--processing-base-method', 'Natural'],
      ['--fermentation-type', 'Anaerobic'],
      ['--process-additive', 'hops'],
      ['--processing-disclosure-level', 'high_detail'],
      ['--processing-confidence-min', '0.8'],
    ];

    for (const args of structuredFlags) {
      const { supabase } = makeSearchSupabase();
      vi.mocked(requireAuth).mockResolvedValueOnce({ supabase, userId: 'user-1' });

      await runCatalogCommand(['search', ...args]);
    }

    expect(vi.mocked(requireAuth).mock.calls).toEqual([
      ['member'],
      ['member'],
      ['member'],
      ['member'],
      ['member'],
    ]);
  });

  it('parses and forwards structured process flags to catalog search filters', async () => {
    const { supabase, query } = makeSearchSupabase();
    vi.mocked(requireAuth).mockResolvedValue({ supabase, userId: 'user-1' });

    await runCatalogCommand([
      'search',
      '--processing-base-method',
      'Natural',
      '--fermentation-type',
      'Anaerobic',
      '--process-additive',
      'hops',
      '--processing-disclosure-level',
      'high_detail',
      '--processing-confidence-min',
      '0.8',
    ]);

    expect(requireAuth).toHaveBeenCalledWith('member');
    expect(query.eq).toHaveBeenCalledWith('processing_base_method', 'Natural');
    expect(query.eq).toHaveBeenCalledWith('fermentation_type', 'Anaerobic');
    expect(query.contains).toHaveBeenCalledWith('process_additives', ['hops']);
    expect(query.eq).toHaveBeenCalledWith('processing_disclosure_level', 'high_detail');
    expect(query.gte).toHaveBeenCalledWith('processing_confidence', 0.8);
  });

  it('rejects invalid processing confidence before auth', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number | string | null
    ) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(
        runCatalogCommand(['search', '--processing-confidence-min', '1.5'])
      ).rejects.toThrow('process.exit:2');

      expect(requireAuth).not.toHaveBeenCalled();
      expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('INVALID_ARGUMENT');
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('searchCatalog', () => {
  it('maps structured process filters to canonical catalog columns', async () => {
    const { supabase, query } = makeSearchSupabase();

    await searchCatalog(supabase, {
      processingBaseMethod: 'Natural',
      fermentationType: 'Anaerobic',
      processAdditive: 'hops',
      processingDisclosureLevel: 'high_detail',
      processingConfidenceMin: 0.8,
    });

    expect(query.eq).toHaveBeenCalledWith('processing_base_method', 'Natural');
    expect(query.eq).toHaveBeenCalledWith('fermentation_type', 'Anaerobic');
    expect(query.contains).toHaveBeenCalledWith('process_additives', ['hops']);
    expect(query.eq).toHaveBeenCalledWith('processing_disclosure_level', 'high_detail');
    expect(query.gte).toHaveBeenCalledWith('processing_confidence', 0.8);
  });

  it('uses /v1/catalog include=proof instead of direct Supabase reads when requested', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    const proof = {
      version: 'proof-summary-v1',
      overall: { label: 'partial', families_with_signals: 2 },
      families: {
        process: {
          label: 'disclosed',
          confidence: 0.85,
          signals: ['structured_process'],
          message: 'Structured process disclosure signals are present.',
        },
      },
      limitations: ['not_certification'],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [makeItem({ proof })] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const from = vi.fn();
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    });
    const supabase = { auth: { getSession }, from } as unknown as SupabaseClient;

    const data = await searchCatalog(supabase, {
      origin: 'Ethiopia',
      processingBaseMethod: 'Natural',
      priceMin: 5,
      stocked: true,
      sort: 'price-desc',
      limit: 5,
      includeProof: true,
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.origin).toBe('https://example.test');
    expect(requestUrl.pathname).toBe('/v1/catalog');
    expect(requestUrl.searchParams.get('include')).toBe('proof');
    expect(requestUrl.searchParams.get('origin')).toBe('Ethiopia');
    expect(requestUrl.searchParams.get('processing_base_method')).toBe('Natural');
    expect(requestUrl.searchParams.get('price_per_lb_min')).toBe('5');
    expect(requestUrl.searchParams.get('stocked')).toBe('true');
    expect(requestUrl.searchParams.get('sortField')).toBe('price_per_lb');
    expect(requestUrl.searchParams.get('sortDirection')).toBe('desc');
    expect(requestUrl.searchParams.get('limit')).toBe('5');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      })
    );
    expect(from).not.toHaveBeenCalled();
    expect(data[0]?.proof).toEqual(proof);
  });

  it('rejects include-proof searches that would silently drop CLI-only filters', async () => {
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(
      searchCatalog(supabase, { flavor: 'berry', includeProof: true })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--flavor'),
    });

    await expect(
      searchCatalog(supabase, { dryingMethod: 'sun', includeProof: true })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--drying-method'),
    });

    await expect(
      searchCatalog(supabase, { supplier: 'Royal', includeProof: true })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--supplier'),
    });

    await expect(
      searchCatalog(supabase, { sort: 'newest', includeProof: true })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--sort newest'),
    });
  });

  it('rejects include-proof offsets that cannot be represented as /v1/catalog pages', async () => {
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(
      searchCatalog(supabase, { offset: 5, limit: 10, includeProof: true })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--offset must be a multiple of --limit'),
    });
  });

  it('ignores pagination flags for include-proof ID searches', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    process.env.PARCHMENT_API_KEY = 'parchment-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [makeItem({ id: 11 }), makeItem({ id: 12 })] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = { auth: { getSession: vi.fn() } } as unknown as SupabaseClient;

    const data = await searchCatalog(supabase, {
      ids: [11, 12],
      offset: 5,
      limit: 2,
      includeProof: true,
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.getAll('ids')).toEqual(['11', '12']);
    expect(requestUrl.searchParams.get('page')).toBeNull();
    expect(requestUrl.searchParams.get('limit')).toBeNull();
    expect(data.map((item) => item.id)).toEqual([11, 12]);
  });

  it('uses API key env when available for include-proof catalog reads', async () => {
    process.env.PARCHMENT_API_KEY = 'parchment-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [makeItem()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const getSession = vi.fn();
    const supabase = { auth: { getSession } } as unknown as SupabaseClient;

    await searchCatalog(supabase, { includeProof: true });

    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer parchment-key' }),
      })
    );
  });

  it('fetches a single proof-backed catalog item through /v1/catalog ids', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    const proof = {
      version: 'proof-summary-v1',
      overall: { label: 'strong', families_with_signals: 4 },
      families: {
        process: {
          label: 'disclosed',
          confidence: 0.85,
          signals: ['structured_process'],
          message: 'Structured process disclosure signals are present.',
        },
      },
      limitations: ['not_certification'],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [makeItem({ id: 42, proof })] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    const data = await getCatalog(supabase, 42, { includeProof: true });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('include')).toBe('proof');
    expect(requestUrl.searchParams.getAll('ids')).toEqual(['42']);
    expect(requestUrl.searchParams.get('limit')).toBeNull();
    expect(data.proof).toEqual(proof);
  });

  it('surfaces clear include-proof API support errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Invalid catalog query',
          message: 'Unsupported include value proof',
          code: 'INVALID_QUERY',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(searchCatalog(supabase, { includeProof: true })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('Catalog API rejected include=proof'),
    });
  });
});

// ─── getCatalogSimilaritySchema ───────────────────────────────────────────────

describe('getCatalogSimilaritySchema', () => {
  it('defaults canonical similarity query options', () => {
    const result = getCatalogSimilaritySchema.parse({ coffee_id: 1182 });
    expect(result).toMatchObject({
      coffee_id: 1182,
      threshold: 0.7,
      limit: 10,
      stockedOnly: false,
      mode: 'all',
    });
  });

  it('rejects thresholds and limits outside the canonical API contract', () => {
    expect(() => getCatalogSimilaritySchema.parse({ coffee_id: 1, threshold: 0.49 })).toThrow();
    expect(() => getCatalogSimilaritySchema.parse({ coffee_id: 1, threshold: 1 })).toThrow();
    expect(() => getCatalogSimilaritySchema.parse({ coffee_id: 1, limit: 26 })).toThrow();
  });
});

// ─── getCatalogSimilarity (lib function) ─────────────────────────────────────

describe('getCatalogSimilarity', () => {
  it('calls /v1/catalog/{id}/similar with canonical query params and session auth', async () => {
    process.env.PURVEYORS_BASE_URL = 'https://example.test';
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    });
    const supabase = { auth: { getSession } } as unknown as SupabaseClient;

    const result = await getCatalogSimilarity(supabase, {
      coffee_id: 1182,
      threshold: 0.85,
      limit: 5,
      stockedOnly: true,
      mode: 'likely_same',
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe('/v1/catalog/1182/similar');
    expect(requestUrl.searchParams.get('threshold')).toBe('0.85');
    expect(requestUrl.searchParams.get('limit')).toBe('5');
    expect(requestUrl.searchParams.get('stocked_only')).toBe('true');
    expect(requestUrl.searchParams.get('mode')).toBe('likely_same');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      })
    );
    expect(result.data.groups.canonical_candidates).toHaveLength(1);
    expect(
      result.data.groups.similar_recommendations[0]?.match.classification.blockers[0]?.code
    ).toBe('processing_base_method_conflict');
    expect(result.meta.classification_version).toBe('canonical-match-v1');
    expect(result.meta.query_strategy).toBe('bounded-vector-candidates-v1');
  });

  it('uses API keys before session lookup for canonical similarity', async () => {
    process.env.PURVEYORS_API_KEY = 'api-key';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeCanonicalSimilarityResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const getSession = vi.fn();
    const supabase = { auth: { getSession } } as unknown as SupabaseClient;

    await getCatalogSimilarity(supabase, { coffee_id: 1182 });

    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer api-key' }),
      })
    );
  });

  it('rejects grouped canonical similarity responses that omit required meta fields', async () => {
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...response,
          meta: { ...response.meta, query_strategy: undefined },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'GENERAL_ERROR',
      message: expect.stringContaining('unexpected response shape'),
    });
  });

  it('preserves structured auth and API error envelopes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Missing API key' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining('Catalog API authentication failed'),
    });
  });

  it('surfaces canonical similarity route failures with endpoint context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid threshold' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('/v1/catalog/{id}/similar'),
    });
  });

  it('maps missing canonical similarity targets to NOT_FOUND', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Catalog coffee 1182 was not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Catalog similarity target not found'),
    });
  });

  it('maps missing canonical similarity routes to CONFIG_ERROR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Route not deployed' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('Catalog similarity API endpoint not found'),
    });
  });

  it('maps generic missing canonical similarity route 404s to CONFIG_ERROR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'text/plain' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
    } as unknown as SupabaseClient;

    await expect(getCatalogSimilarity(supabase, { coffee_id: 1182 })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('Catalog similarity API endpoint not found'),
    });
  });
});

// ─── findSimilarBeansSchema ───────────────────────────────────────────────────

describe('findSimilarBeansSchema', () => {
  it('requires coffee_id', () => {
    expect(() => findSimilarBeansSchema.parse({})).toThrow();
  });

  it('rejects coffee_id of 0', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 0 })).toThrow();
  });

  it('rejects negative coffee_id', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: -5 })).toThrow();
  });

  it('rejects float coffee_id', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1.5 })).toThrow();
  });

  it('accepts a valid positive integer coffee_id', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 42 });
    expect(result.coffee_id).toBe(42);
  });

  it('applies default threshold of 0.7 when omitted', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1 });
    expect(result.threshold).toBe(0.7);
  });

  it('accepts threshold of 0 (inclusive lower bound)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 0 });
    expect(result.threshold).toBe(0);
  });

  it('accepts threshold of 1 (inclusive upper bound)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 1 });
    expect(result.threshold).toBe(1);
  });

  it('rejects threshold greater than 1', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 1.1 })).toThrow();
  });

  it('rejects threshold less than 0', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, threshold: -0.1 })).toThrow();
  });

  it('applies default limit of 10 when omitted', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1 });
    expect(result.limit).toBe(10);
  });

  it('accepts limit of 1 (minimum)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, limit: 1 });
    expect(result.limit).toBe(1);
  });

  it('accepts limit of 50 (maximum)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, limit: 50 });
    expect(result.limit).toBe(50);
  });

  it('rejects limit of 0', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 0 })).toThrow();
  });

  it('rejects limit of 51 (exceeds maximum)', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 51 })).toThrow();
  });

  it('rejects non-integer limit', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 5.5 })).toThrow();
  });

  it('only requires coffee_id — threshold and limit are optional', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 7 })).not.toThrow();
  });
});

// ─── findSimilarBeans (lib function) ─────────────────────────────────────────

function makeSupabaseRpc(response: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(response),
  } as unknown as SupabaseClient;
}

const FIXTURE_BEANS: SimilarBean[] = [
  {
    coffee_id: 10,
    coffee_name: 'Ethiopian Yirgacheffe',
    source: "Sweet Maria's",
    origin: 'Ethiopia',
    processing: 'washed',
    cost_lb: 8.5,
    price_per_lb: 8.5,
    stocked: true,
    avg_similarity: 0.91,
    chunk_matches: 3,
  },
  {
    coffee_id: 22,
    coffee_name: 'Kenya Kirinyaga',
    source: "Sweet Maria's",
    origin: 'Kenya',
    processing: 'washed',
    cost_lb: 9.0,
    price_per_lb: 9.0,
    stocked: true,
    avg_similarity: 0.85,
    chunk_matches: 2,
  },
];

describe('findSimilarBeans', () => {
  it('returns SimilarBean[] on successful RPC call', async () => {
    const supabase = makeSupabaseRpc({ data: FIXTURE_BEANS, error: null });
    const result = await findSimilarBeans(supabase, { coffee_id: 5 });
    expect(result).toHaveLength(2);
    expect(result[0].coffee_id).toBe(10);
    expect(result[1].coffee_name).toBe('Kenya Kirinyaga');
  });

  it('returns empty array when RPC returns null', async () => {
    const supabase = makeSupabaseRpc({ data: null, error: null });
    const result = await findSimilarBeans(supabase, { coffee_id: 5 });
    expect(result).toEqual([]);
  });

  it('returns empty array when RPC returns empty array', async () => {
    const supabase = makeSupabaseRpc({ data: [], error: null });
    const result = await findSimilarBeans(supabase, { coffee_id: 5 });
    expect(result).toEqual([]);
  });

  it('throws Error with "RPC error:" prefix when RPC returns an error', async () => {
    const supabase = makeSupabaseRpc({ data: null, error: { message: 'function not found' } });
    await expect(findSimilarBeans(supabase, { coffee_id: 5 })).rejects.toThrow(
      'RPC error: function not found'
    );
  });

  it('passes target_coffee_id, match_threshold, and match_count to RPC', async () => {
    const supabase = makeSupabaseRpc({ data: [], error: null });
    await findSimilarBeans(supabase, { coffee_id: 42, threshold: 0.8, limit: 5 });
    expect(supabase.rpc as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'find_similar_beans_aggregated',
      { target_coffee_id: 42, match_threshold: 0.8, match_count: 5 }
    );
  });

  it('uses schema defaults (0.7 threshold, 10 limit) when not provided', async () => {
    const supabase = makeSupabaseRpc({ data: [], error: null });
    await findSimilarBeans(supabase, { coffee_id: 7 });
    expect(supabase.rpc as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'find_similar_beans_aggregated',
      { target_coffee_id: 7, match_threshold: 0.7, match_count: 10 }
    );
  });

  it('uses provided threshold and limit when specified', async () => {
    const supabase = makeSupabaseRpc({ data: FIXTURE_BEANS, error: null });
    const result = await findSimilarBeans(supabase, { coffee_id: 3, threshold: 0.5, limit: 20 });
    expect(supabase.rpc as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'find_similar_beans_aggregated',
      { target_coffee_id: 3, match_threshold: 0.5, match_count: 20 }
    );
    expect(result).toHaveLength(2);
  });
});
