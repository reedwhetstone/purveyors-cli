import { describe, it, expect } from 'vitest';
import { sanitizeFilterValue, searchCatalogSchema } from '../src/lib/catalog.js';
import { isValidCuppingScore, rateCoffeeSchema } from '../src/lib/tasting.js';

// ─── sanitizeFilterValue ──────────────────────────────────────────────────────

describe('sanitizeFilterValue', () => {
  it('removes PostgREST special characters', () => {
    expect(sanitizeFilterValue('(bad)')).toBe('bad');
    expect(sanitizeFilterValue('a,b,c')).toBe('abc');
    expect(sanitizeFilterValue('test.value')).toBe('testvalue');
    expect(sanitizeFilterValue('wild*card')).toBe('wildcard');
  });

  it('leaves normal strings untouched', () => {
    expect(sanitizeFilterValue('Ethiopia')).toBe('Ethiopia');
    expect(sanitizeFilterValue('natural washed')).toBe('natural washed');
    expect(sanitizeFilterValue('berry chocolate')).toBe('berry chocolate');
  });

  it('handles empty string', () => {
    expect(sanitizeFilterValue('')).toBe('');
  });

  it('removes all special chars in a complex string', () => {
    expect(sanitizeFilterValue('(eth,opia).nat*ural')).toBe('ethopianatural');
  });
});

// ─── searchCatalogSchema ──────────────────────────────────────────────────────

describe('searchCatalogSchema', () => {
  it('applies default limit of 10', () => {
    const parsed = searchCatalogSchema.parse({});
    expect(parsed.limit).toBe(10);
  });

  it('accepts all optional fields', () => {
    const parsed = searchCatalogSchema.parse({
      origin: 'Ethiopia',
      process: 'natural',
      priceMin: 5.0,
      priceMax: 20.0,
      flavor: 'berry',
      stocked: true,
      limit: 25,
    });
    expect(parsed.origin).toBe('Ethiopia');
    expect(parsed.process).toBe('natural');
    expect(parsed.priceMin).toBe(5.0);
    expect(parsed.priceMax).toBe(20.0);
    expect(parsed.flavor).toBe('berry');
    expect(parsed.stocked).toBe(true);
    expect(parsed.limit).toBe(25);
  });

  it('rejects limit of 0', () => {
    expect(() => searchCatalogSchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects negative limit', () => {
    expect(() => searchCatalogSchema.parse({ limit: -1 })).toThrow();
  });

  it('allows partial options (only origin)', () => {
    const parsed = searchCatalogSchema.parse({ origin: 'Colombia' });
    expect(parsed.origin).toBe('Colombia');
    expect(parsed.limit).toBe(10);
  });
});

// ─── rateCoffeeSchema ─────────────────────────────────────────────────────────

describe('rateCoffeeSchema', () => {
  const validInput = {
    aroma: 4,
    body: 3,
    acidity: 5,
    sweetness: 4,
    aftertaste: 3,
  };

  it('accepts valid cupping scores 1-5', () => {
    const parsed = rateCoffeeSchema.parse(validInput);
    expect(parsed.aroma).toBe(4);
    expect(parsed.body).toBe(3);
  });

  it('accepts optional brewMethod and notes', () => {
    const parsed = rateCoffeeSchema.parse({
      ...validInput,
      brewMethod: 'pour_over',
      notes: 'Very fruity',
    });
    expect(parsed.brewMethod).toBe('pour_over');
    expect(parsed.notes).toBe('Very fruity');
  });

  it('rejects scores out of range', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, aroma: 0 })).toThrow();
    expect(() => rateCoffeeSchema.parse({ ...validInput, body: 6 })).toThrow();
    expect(() => rateCoffeeSchema.parse({ ...validInput, acidity: -1 })).toThrow();
  });

  it('rejects non-integer scores', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, sweetness: 3.5 })).toThrow();
  });
});

// ─── isValidCuppingScore ──────────────────────────────────────────────────────

describe('isValidCuppingScore (lib/tasting)', () => {
  it('returns true for integers 1-5', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(isValidCuppingScore(n)).toBe(true);
    }
  });

  it('returns false for out-of-range values', () => {
    expect(isValidCuppingScore(0)).toBe(false);
    expect(isValidCuppingScore(6)).toBe(false);
  });

  it('returns false for floats', () => {
    expect(isValidCuppingScore(3.5)).toBe(false);
  });
});
