import { describe, it, expect, vi } from 'vitest';
import {
  computeCatalogStats,
  searchCatalogSchema,
  sanitizeFilterValue,
  findSimilarBeansSchema,
  findSimilarBeans,
} from '../src/lib/catalog.js';
import type { CatalogItem, SimilarBean } from '../src/lib/catalog.js';
import type { SupabaseClient } from '@supabase/supabase-js';

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
