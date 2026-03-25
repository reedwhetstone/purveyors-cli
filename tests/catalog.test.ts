import { describe, it, expect } from 'vitest';
import {
  computeCatalogStats,
  searchCatalogSchema,
  sanitizeFilterValue,
} from '../src/lib/catalog.js';
import type { CatalogItem } from '../src/lib/catalog.js';

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
