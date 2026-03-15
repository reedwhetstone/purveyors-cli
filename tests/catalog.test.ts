import { describe, it, expect } from 'vitest';
import { computeCatalogStats } from '../src/lib/catalog.js';
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
    price_tiers: null,
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
    const items = [makeItem({ id: 1, cost_lb: 10.0 }), makeItem({ id: 2, cost_lb: 20.0 })];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(15.0);
  });

  it('rounds average price to 2 decimal places', () => {
    const items = [
      makeItem({ id: 1, cost_lb: 10.0 }),
      makeItem({ id: 2, cost_lb: 11.0 }),
      makeItem({ id: 3, cost_lb: 12.0 }),
    ];
    const stats = computeCatalogStats(items);
    // (10 + 11 + 12) / 3 = 11.0
    expect(stats.avgPricePerLb).toBe(11.0);
  });

  it('skips null prices when computing average', () => {
    const items = [
      makeItem({ id: 1, cost_lb: 10.0 }),
      makeItem({ id: 2, cost_lb: null }),
      makeItem({ id: 3, cost_lb: 20.0 }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBe(15.0);
  });

  it('returns null average when all prices are null', () => {
    const items = [makeItem({ id: 1, cost_lb: null }), makeItem({ id: 2, cost_lb: null })];
    const stats = computeCatalogStats(items);
    expect(stats.avgPricePerLb).toBeNull();
  });

  it('computes price range correctly', () => {
    const items = [
      makeItem({ id: 1, cost_lb: 8.5 }),
      makeItem({ id: 2, cost_lb: 25.0 }),
      makeItem({ id: 3, cost_lb: 15.0 }),
    ];
    const stats = computeCatalogStats(items);
    expect(stats.priceRange.min).toBe(8.5);
    expect(stats.priceRange.max).toBe(25.0);
  });

  it('returns null price range when no items have prices', () => {
    const items = [makeItem({ id: 1, cost_lb: null })];
    const stats = computeCatalogStats(items);
    expect(stats.priceRange.min).toBeNull();
    expect(stats.priceRange.max).toBeNull();
  });
});
