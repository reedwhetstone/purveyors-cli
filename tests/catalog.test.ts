import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/auth-guard.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return {
    ...actual,
    createParchmentClient: vi.fn(),
    resolveParchmentToken: vi.fn(),
  };
});

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
import { createParchmentClient, resolveParchmentToken } from '../src/lib/parchment.js';
import {
  computeCatalogStats,
  computeCatalogPremiumRanking,
  computeSupplierAggregates,
  summarizePurveyorScore,
  catalogRankPremium,
  listCatalogFacets,
  rankCatalog,
  supplierList,
  supplierDetail,
  supplierRank,
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
import type { CatalogItem, CatalogSimilarityResponse } from '../src/lib/catalog.js';
import type { CredentialContext } from '../src/lib/auth-client.js';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PARCHMENT_API_KEY;
  delete process.env.PURVEYORS_API_KEY;
  delete process.env.PARCHMENT_API_BASE_URL;
  delete process.env.PURVEYORS_BASE_URL;
  vi.mocked(resolveParchmentToken).mockImplementation(async (role = 'viewer') => {
    const apiKey = process.env.PARCHMENT_API_KEY || process.env.PURVEYORS_API_KEY;
    if (apiKey) return apiKey;
    await vi.mocked(requireAuth)(role);
    return 'session-token';
  });
  vi.mocked(createParchmentClient).mockImplementation(async (role = 'viewer') => {
    if (!process.env.PARCHMENT_API_KEY && !process.env.PURVEYORS_API_KEY) {
      await vi.mocked(requireAuth)(role);
    }
    const ok = (data: unknown) => ({
      data,
      response: new Response(null, { status: 200 }),
    });
    return {
      catalog: {
        list: vi.fn().mockResolvedValue(ok({ data: [], pagination: {}, meta: {} })),
        facets: vi.fn().mockResolvedValue(ok({ facets: {}, values: {}, meta: { access: {} } })),
        stats: vi.fn().mockResolvedValue(
          ok({
            stats: {
              total: 0,
              stocked: 0,
              byOrigin: {},
              avgPricePerLb: null,
              priceRange: { min: null, max: null },
            },
            meta: {},
          })
        ),
        rank: vi.fn().mockResolvedValue(ok({ data: [], meta: {} })),
        rankPremium: vi.fn().mockResolvedValue(ok({ data: [], meta: {} })),
        suppliers: vi.fn().mockResolvedValue(ok({ data: [], meta: {} })),
        supplierDetail: vi.fn().mockResolvedValue(ok({ data: [], meta: {} })),
        supplierRank: vi.fn().mockResolvedValue(ok({ data: [], meta: {} })),
      },
    } as never;
  });
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
    purveyor_score: null,
    purveyor_score_confidence: null,
    purveyor_score_tier: null,
    purveyor_score_factors: null,
    purveyor_score_version: 'purveyor-score-v1',
    purveyor_score_updated_at: null,
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

describe('catalog intelligence helpers', () => {
  it('summarizes Purveyor Score bands without recomputing scores', () => {
    expect(summarizePurveyorScore(null)).toMatchObject({ value: null, band: 'unscored' });
    expect(summarizePurveyorScore(91)).toMatchObject({ value: 91, band: 'premium' });
    expect(summarizePurveyorScore(86)).toMatchObject({ value: 86, band: 'strong' });
    expect(summarizePurveyorScore(80)).toMatchObject({ value: 80, band: 'scored' });
  });

  it('ranks premium catalog rows by score, then cheaper price', () => {
    const ranked = computeCatalogPremiumRanking([
      makeItem({ id: 1, name: 'Unscored', purveyor_score: null }),
      makeItem({
        id: 2,
        name: 'Expensive 90',
        purveyor_score: 90,
        price_per_lb: 15,
        price_tiers: null,
      }),
      makeItem({
        id: 3,
        name: 'Cheap 90',
        purveyor_score: 90,
        price_per_lb: 10,
        price_tiers: null,
      }),
      makeItem({ id: 4, name: 'Top', purveyor_score: 94, price_per_lb: 20, price_tiers: null }),
    ]);

    expect(ranked.map((item) => item.id)).toEqual([4, 3, 2]);
    expect(ranked[0]).toMatchObject({
      rank: 1,
      purveyor_score: { value: 94, band: 'premium', source: 'purveyor_score' },
    });
    expect(ranked[0]?.signals).toContain('purveyor_score=94');
  });

  it('can include unscored rows after scored candidates', () => {
    const ranked = computeCatalogPremiumRanking(
      [makeItem({ id: 1, purveyor_score: null }), makeItem({ id: 2, purveyor_score: 82 })],
      { includeUnscored: true }
    );

    expect(ranked.map((item) => item.id)).toEqual([2, 1]);
    expect(ranked[1]?.purveyor_score.band).toBe('unscored');
  });

  it('computes supplier aggregates with score coverage, prices, and top coffees', () => {
    const aggregates = computeSupplierAggregates([
      makeItem({
        id: 1,
        source: 'Royal Coffee',
        purveyor_score: 90,
        price_per_lb: 10,
        price_tiers: null,
      }),
      makeItem({
        id: 2,
        source: 'Royal Coffee',
        purveyor_score: null,
        price_per_lb: 14,
        price_tiers: null,
      }),
      makeItem({
        id: 3,
        source: 'Cafe Imports',
        purveyor_score: 88,
        price_per_lb: 9,
        price_tiers: null,
      }),
    ]);

    expect(aggregates[0]?.supplier).toBe('Royal Coffee');
    expect(aggregates[0]?.score).toEqual({
      average: 90,
      coverage: 0.5,
      scored_count: 1,
      top_score: 90,
      average_confidence: null,
      confidence_coverage: 0,
    });
    expect(aggregates[0]?.price.average_per_lb).toBe(12);
    expect(aggregates[0]?.top_coffees[0]?.id).toBe(1);
  });

  it('reads counted facets through the canonical SDK endpoint', async () => {
    const facets = vi.fn().mockResolvedValue({
      data: {
        facets: { sources: [{ value: 'Royal Coffee', count: 4 }] },
        values: {},
        meta: { access: {} },
      },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { facets } } as never);

    const response = await listCatalogFacets({ field: 'supplier', stockedOnly: true, limit: 10 });

    expect(facets).toHaveBeenCalledWith({ stocked: 'true' });
    expect(response.data).toEqual([{ value: 'Royal Coffee', count: 4 }]);
    expect(response.meta).toMatchObject({ sample_limited: false, rows_examined: 4 });
  });

  it('forwards deterministic ranking inputs to the canonical SDK endpoint', async () => {
    const envelope = {
      data: [{ ...makeItem(), rank: 1, rank_basis: 'highest score' }],
      meta: { resource: 'catalog-ranking', scoring_source: 'coffee_catalog.purveyor_score' },
    };
    const rank = vi.fn().mockResolvedValue({
      data: envelope,
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { rank } } as never);

    const response = await rankCatalog({
      objective: 'value',
      country: 'Ethiopia',
      nonWholesaleOnly: true,
      limit: 5,
    });

    expect(rank).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'value',
        country: 'Ethiopia',
        nonWholesaleOnly: 'true',
        limit: 5,
      })
    );
    expect(response).toEqual(envelope);
  });
});

describe('searchCatalogSchema', () => {
  it('accepts name as optional string', () => {
    const result = searchCatalogSchema.parse({ name: 'Guji' });
    expect(result.name).toBe('Guji');
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
    expect(result.ids).toBeUndefined();
  });

  it('combines new fields with existing fields', () => {
    const result = searchCatalogSchema.parse({
      origin: 'Ethiopia',
      name: 'Guji',
      stocked: true,
    });
    expect(result.origin).toBe('Ethiopia');
    expect(result.name).toBe('Guji');
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

  it('allows variety and stockedDays to be omitted', () => {
    const result = searchCatalogSchema.parse({});
    expect(result.variety).toBeUndefined();
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

  it('combines variety and stockedDays with existing fields', () => {
    const result = searchCatalogSchema.parse({
      origin: 'Ethiopia',
      variety: 'heirloom',
      stocked: true,
      stockedDays: 14,
    });
    expect(result.origin).toBe('Ethiopia');
    expect(result.variety).toBe('heirloom');
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

function makeSearchCredentialContext(response: { data?: unknown; error?: unknown | null } = {}) {
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

  return { credentialContext: { from } as unknown as CredentialContext, query, select, from };
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
    const { credentialContext } = makeSearchCredentialContext();
    vi.mocked(requireAuth).mockResolvedValue({ credentialContext, userId: 'user-1' });

    await runCatalogCommand(['search', '--origin', 'Ethiopia']);

    expect(requireAuth).toHaveBeenCalledWith('viewer');
  });

  it('uses API-key catalog proof reads without session auth when an API key env is set', async () => {
    process.env.PARCHMENT_API_KEY = 'parchment-key';
    const list = vi.fn().mockResolvedValue({
      data: { data: [makeItem()], pagination: {}, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);

    await runCatalogCommand(['search', '--include-proof']);

    expect(requireAuth).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ include: 'proof' }));
  });

  it('uses API-key canonical similarity reads without session auth when an API key env is set', async () => {
    process.env.PARCHMENT_API_BASE_URL = 'https://example.test';
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

  it('uses member session auth for canonical similarity reads when no API key env is set', async () => {
    process.env.PARCHMENT_API_BASE_URL = 'https://example.test';
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const credentialContext = {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { apiKey: 'session-token' } },
      }),
    } as unknown as CredentialContext;
    vi.mocked(requireAuth).mockResolvedValue({ credentialContext, userId: 'user-1' });

    await runCatalogCommand(['similar', '1182']);

    expect(requireAuth).toHaveBeenCalledWith('member');
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
      const { credentialContext } = makeSearchCredentialContext();
      vi.mocked(requireAuth).mockResolvedValueOnce({ credentialContext, userId: 'user-1' });

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

  it('passes supplier aggregate CLI country and non-wholesale flags to the query layer', async () => {
    const supplierRankSdk = vi.fn().mockResolvedValue({
      data: { data: [], meta: { filters: { country: 'Ethiopia', nonWholesaleOnly: true } } },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({
      catalog: { supplierRank: supplierRankSdk },
    } as never);

    await runCatalogCommand([
      'supplier-rank',
      '--country',
      'Ethiopia',
      '--non-wholesale-only',
      '--min-coffees',
      '1',
      '--limit',
      '5',
    ]);

    expect(supplierRankSdk).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Ethiopia', nonWholesaleOnly: 'true', minCoffees: 1 })
    );
    expect(outputData).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          filters: expect.objectContaining({
            country: 'Ethiopia',
            nonWholesaleOnly: true,
          }),
        }),
      }),
      expect.any(Object)
    );
  });

  it.each([
    {
      args: ['facets', 'not-a-field'],
      message: 'Invalid field',
      value: 'not-a-field',
    },
    {
      args: ['facets', 'supplier', '--limit', '101'],
      message: 'Invalid --limit',
      value: '101',
    },
    {
      args: ['rank', '--objective', 'fastest'],
      message: 'Invalid --objective',
      value: 'fastest',
    },
    {
      args: ['rank', '--sample-size', '0'],
      message: 'Invalid --sample-size',
      value: '0',
    },
    {
      args: ['rank-premium', '--limit', 'nope'],
      message: 'Invalid --limit',
      value: 'nope',
    },
    {
      args: ['rank-premium', '--sample-size', '0'],
      message: 'Invalid --sample-size',
      value: '0',
    },
    {
      args: ['supplier-list', '--limit', '101'],
      message: 'Invalid --limit',
      value: '101',
    },
    {
      args: ['supplier-list', '--sample-size', 'too-many'],
      message: 'Invalid --sample-size',
      value: 'too-many',
    },
    {
      args: ['supplier-detail', 'Royal Coffee', '--top-coffees', '26'],
      message: 'Invalid --top-coffees',
      value: '26',
    },
    {
      args: ['supplier-rank', '--min-coffees', 'none'],
      message: 'Invalid --min-coffees',
      value: 'none',
    },
  ])(
    'rejects malformed new catalog intelligence flags before auth: $args',
    async ({ args, message, value }) => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
        code?: number | string | null
      ) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        await expect(runCatalogCommand(args)).rejects.toThrow('process.exit:2');

        expect(requireAuth).not.toHaveBeenCalled();
        const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(stderr).toContain('INVALID_ARGUMENT');
        expect(stderr).toContain(message);
        expect(stderr).toContain(value);
      } finally {
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
      }
    }
  );
});

describe('searchCatalog', () => {
  it('maps supported CLI filters and offset pagination to the canonical SDK query', async () => {
    const list = vi.fn().mockResolvedValue({
      data: { data: [makeItem()], pagination: {}, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);

    const data = await searchCatalog({
      origin: 'Ethiopia',
      processingBaseMethod: 'Natural',
      fermentationType: 'Anaerobic',
      processAdditive: 'hops',
      sort: 'price-desc',
      offset: 20,
      limit: 10,
    });

    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'Ethiopia',
        processing_base_method: 'Natural',
        fermentation_type: 'Anaerobic',
        process_additive: 'hops',
        sort: 'price_per_lb',
        order: 'desc',
        page: 3,
        limit: 10,
      })
    );
    expect(data).toHaveLength(1);
  });

  it('rejects the retired newest sort value', async () => {
    await expect(searchCatalog({ sort: 'newest' as never })).rejects.toThrow('Invalid option');
  });

  it('rejects offsets that cannot be represented by canonical page pagination', async () => {
    await expect(searchCatalog({ offset: 5, limit: 10 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--offset to be a multiple of --limit'),
    });
    expect(createParchmentClient).not.toHaveBeenCalled();
  });

  it('requests the SDK proof projection and returns its typed row summary', async () => {
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
    const list = vi.fn().mockResolvedValue({
      data: { data: [makeItem({ proof })], pagination: {}, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    const data = await searchCatalog({
      origin: 'Ethiopia',
      processingBaseMethod: 'Natural',
      priceMin: 5,
      stocked: true,
      sort: 'price-desc',
      limit: 5,
      includeProof: true,
    });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        include: 'proof',
        origin: 'Ethiopia',
        processing_base_method: 'Natural',
        pricePerLbMin: 5,
        stocked: 'true',
        sort: 'price_per_lb',
        order: 'desc',
        limit: 5,
      })
    );
    expect(data[0]?.proof).toEqual(proof);
  });

  it('rejects retired catalog flags as unknown Commander options', async () => {
    for (const args of [
      ['search', '--flavor', 'berry'],
      ['search', '--supplier', 'Royal'],
      ['search', '--drying-method', 'sun'],
    ]) {
      const errors: string[] = [];
      const command = buildCatalogCommand();
      command.exitOverride();
      command.configureOutput({
        writeOut: () => undefined,
        writeErr: () => undefined,
        outputError: (message) => errors.push(message),
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
        code?: number | string | null
      ) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
      try {
        await expect(
          command.parseAsync(['node', 'catalog', ...args], { from: 'node' })
        ).rejects.toThrow('process.exit:1');
        expect(errors.join('')).toContain(`unknown option '${args[1]}'`);
      } finally {
        exitSpy.mockRestore();
      }
    }
  });

  it('rejects include-proof offsets that cannot be represented as /v1/catalog pages', async () => {
    await expect(searchCatalog({ offset: 5, limit: 10, includeProof: true })).rejects.toMatchObject(
      {
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('Canonical catalog pagination requires --offset'),
      }
    );
  });

  it('ignores pagination flags for include-proof ID searches', async () => {
    const list = vi.fn().mockResolvedValue({
      data: { data: [makeItem({ id: 11 }), makeItem({ id: 12 })], pagination: {}, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    const data = await searchCatalog({
      ids: [11, 12],
      offset: 5,
      limit: 2,
      includeProof: true,
    });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ include: 'proof', coffeeIds: '11,12', page: 1, limit: 2 })
    );
    expect(data.map((item) => item.id)).toEqual([11, 12]);
  });

  it('fetches a single proof-backed catalog item through the SDK list method', async () => {
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
    const list = vi.fn().mockResolvedValue({
      data: { data: [makeItem({ id: 42, proof })], pagination: {}, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    const data = await getCatalog(42, { includeProof: true });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ include: 'proof', coffeeIds: '42', limit: 1 })
    );
    expect(data.proof).toEqual(proof);
  });

  it('surfaces clear include-proof API support errors', async () => {
    const list = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: 'Unsupported include value proof' },
      response: new Response(null, { status: 400 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { list } } as never);
    await expect(searchCatalog({ includeProof: true })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'Unsupported include value proof',
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
    process.env.PARCHMENT_API_BASE_URL = 'https://example.test';
    const response = makeCanonicalSimilarityResponse();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCatalogSimilarity({
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
    await getCatalogSimilarity({ coffee_id: 1182 });

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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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
    await expect(getCatalogSimilarity({ coffee_id: 1182 })).rejects.toMatchObject({
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

  it('accepts threshold of 0.5 (inclusive canonical lower bound)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 0.5 });
    expect(result.threshold).toBe(0.5);
  });

  it('accepts threshold of 0.99 (inclusive canonical upper bound)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 0.99 });
    expect(result.threshold).toBe(0.99);
  });

  it('rejects threshold above the canonical maximum', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 1 })).toThrow();
  });

  it('rejects threshold below the canonical minimum', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, threshold: 0.49 })).toThrow();
  });

  it('applies default limit of 10 when omitted', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1 });
    expect(result.limit).toBe(10);
  });

  it('accepts limit of 1 (minimum)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, limit: 1 });
    expect(result.limit).toBe(1);
  });

  it('accepts limit of 25 (canonical maximum)', () => {
    const result = findSimilarBeansSchema.parse({ coffee_id: 1, limit: 25 });
    expect(result.limit).toBe(25);
  });

  it('rejects limit of 0', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 0 })).toThrow();
  });

  it('rejects limit above the canonical maximum', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 26 })).toThrow();
  });

  it('rejects non-integer limit', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 1, limit: 5.5 })).toThrow();
  });

  it('only requires coffee_id — threshold and limit are optional', () => {
    expect(() => findSimilarBeansSchema.parse({ coffee_id: 7 })).not.toThrow();
  });
});

describe('remaining catalog intelligence SDK surfaces', () => {
  it('uses the canonical premium ranking endpoint', async () => {
    const envelope = { data: [], meta: { resource: 'catalog-premium-ranking' } };
    const rankPremium = vi.fn().mockResolvedValue({
      data: envelope,
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ catalog: { rankPremium } } as never);

    await expect(
      catalogRankPremium({ origin: 'Ethiopia', stocked: true, includeUnscored: true, limit: 5 })
    ).resolves.toEqual(envelope);
    expect(rankPremium).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'Ethiopia',
        stocked: 'true',
        includeUnscored: 'true',
        limit: 5,
      })
    );
  });

  it('uses the canonical supplier list, detail, and rank endpoints', async () => {
    const envelope = { data: [], meta: { resource: 'catalog-suppliers' } };
    const result = { data: envelope, response: new Response(null, { status: 200 }) };
    const suppliers = vi.fn().mockResolvedValue(result);
    const supplierDetailSdk = vi.fn().mockResolvedValue(result);
    const supplierRankSdk = vi.fn().mockResolvedValue(result);
    vi.mocked(createParchmentClient).mockResolvedValue({
      catalog: { suppliers, supplierDetail: supplierDetailSdk, supplierRank: supplierRankSdk },
    } as never);

    await supplierList({ country: 'Colombia', stocked: true });
    await supplierDetail({ supplier: 'Royal Coffee', topCoffees: 3 });
    await supplierRank({ minCoffees: 2, nonWholesaleOnly: true });

    expect(suppliers).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Colombia', stocked: 'true' })
    );
    expect(supplierDetailSdk).toHaveBeenCalledWith(
      expect.objectContaining({ supplier: 'Royal Coffee', topCoffees: 3 })
    );
    expect(supplierRankSdk).toHaveBeenCalledWith(
      expect.objectContaining({ minCoffees: 2, nonWholesaleOnly: 'true' })
    );
  });

  it('maps canonical similarity matches to the legacy flat helper shape', async () => {
    process.env.PARCHMENT_API_KEY = 'api-key';
    const canonical = makeCanonicalSimilarityResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(canonical), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    const result = await findSimilarBeans({ coffee_id: 1182, threshold: 0.7, limit: 10 });

    expect(result[0]).toMatchObject({
      coffee_id: 1199,
      coffee_name: 'Sibling Lot',
      avg_similarity: 0.91,
      chunk_matches: 3,
    });
  });
});
