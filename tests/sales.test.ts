import { describe, it, expect } from 'vitest';
import {
  listSalesSchema,
  recordSaleSchema,
  updateSaleSchema,
  deleteSaleSchema,
} from '../src/lib/sales.js';

// ─── listSalesSchema ──────────────────────────────────────────────────────────

describe('listSalesSchema', () => {
  it('applies default limit of 20', () => {
    const parsed = listSalesSchema.parse({});
    expect(parsed.limit).toBe(20);
  });

  it('accepts a custom limit', () => {
    const parsed = listSalesSchema.parse({ limit: 50 });
    expect(parsed.limit).toBe(50);
  });

  it('rejects limit of 0', () => {
    expect(() => listSalesSchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects negative limit', () => {
    expect(() => listSalesSchema.parse({ limit: -1 })).toThrow();
  });

  it('rejects non-integer limit', () => {
    expect(() => listSalesSchema.parse({ limit: 2.5 })).toThrow();
  });

  it('accepts roastId as positive integer', () => {
    const parsed = listSalesSchema.parse({ roastId: 42 });
    expect(parsed.roastId).toBe(42);
  });

  it('rejects non-positive roastId', () => {
    expect(() => listSalesSchema.parse({ roastId: 0 })).toThrow();
    expect(() => listSalesSchema.parse({ roastId: -1 })).toThrow();
  });

  it('rejects non-integer roastId', () => {
    expect(() => listSalesSchema.parse({ roastId: 1.5 })).toThrow();
  });

  it('accepts dateStart as a string', () => {
    const parsed = listSalesSchema.parse({ dateStart: '2026-03-01' });
    expect(parsed.dateStart).toBe('2026-03-01');
  });

  it('accepts dateEnd as a string', () => {
    const parsed = listSalesSchema.parse({ dateEnd: '2026-03-31' });
    expect(parsed.dateEnd).toBe('2026-03-31');
  });

  it('accepts buyer as a string', () => {
    const parsed = listSalesSchema.parse({ buyer: 'Jane' });
    expect(parsed.buyer).toBe('Jane');
  });

  it('allows all filter fields to be omitted', () => {
    const parsed = listSalesSchema.parse({});
    expect(parsed.roastId).toBeUndefined();
    expect(parsed.dateStart).toBeUndefined();
    expect(parsed.dateEnd).toBeUndefined();
    expect(parsed.buyer).toBeUndefined();
  });

  it('accepts all filters together', () => {
    const parsed = listSalesSchema.parse({
      roastId: 42,
      dateStart: '2026-01-01',
      dateEnd: '2026-03-31',
      buyer: 'Alice',
      limit: 50,
    });
    expect(parsed.roastId).toBe(42);
    expect(parsed.dateStart).toBe('2026-01-01');
    expect(parsed.dateEnd).toBe('2026-03-31');
    expect(parsed.buyer).toBe('Alice');
    expect(parsed.limit).toBe(50);
  });
});

// ─── recordSaleSchema ─────────────────────────────────────────────────────────

describe('recordSaleSchema', () => {
  const validInput = {
    roastId: 42,
    oz: 12,
    price: 18.5,
  };

  it('accepts valid required fields', () => {
    const parsed = recordSaleSchema.parse(validInput);
    expect(parsed.roastId).toBe(42);
    expect(parsed.oz).toBe(12);
    expect(parsed.price).toBe(18.5);
  });

  it('accepts optional buyer and sellDate', () => {
    const parsed = recordSaleSchema.parse({
      ...validInput,
      buyer: 'Alice',
      sellDate: '2026-03-23',
    });
    expect(parsed.buyer).toBe('Alice');
    expect(parsed.sellDate).toBe('2026-03-23');
  });

  it('rejects missing roastId', () => {
    const result = recordSaleSchema.safeParse({ oz: 12, price: 18 });
    expect(result.success).toBe(false);
  });

  it('rejects missing oz', () => {
    const result = recordSaleSchema.safeParse({ roastId: 42, price: 18 });
    expect(result.success).toBe(false);
  });

  it('rejects missing price', () => {
    const result = recordSaleSchema.safeParse({ roastId: 42, oz: 12 });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive roastId', () => {
    expect(() => recordSaleSchema.parse({ ...validInput, roastId: 0 })).toThrow();
    expect(() => recordSaleSchema.parse({ ...validInput, roastId: -1 })).toThrow();
  });

  it('rejects non-positive oz', () => {
    expect(() => recordSaleSchema.parse({ ...validInput, oz: 0 })).toThrow();
    expect(() => recordSaleSchema.parse({ ...validInput, oz: -5 })).toThrow();
  });

  it('rejects negative price', () => {
    expect(() => recordSaleSchema.parse({ ...validInput, price: -1 })).toThrow();
  });

  it('accepts zero price (free/gift)', () => {
    const parsed = recordSaleSchema.parse({ ...validInput, price: 0 });
    expect(parsed.price).toBe(0);
  });

  it('rejects non-integer roastId', () => {
    expect(() => recordSaleSchema.parse({ ...validInput, roastId: 3.5 })).toThrow();
  });
});

// ─── updateSaleSchema ─────────────────────────────────────────────────────────

describe('updateSaleSchema', () => {
  it('accepts oz only', () => {
    const result = updateSaleSchema.safeParse({ oz: 16 });
    expect(result.success).toBe(true);
  });

  it('accepts price only', () => {
    const result = updateSaleSchema.safeParse({ price: 22.5 });
    expect(result.success).toBe(true);
  });

  it('accepts buyer only', () => {
    const result = updateSaleSchema.safeParse({ buyer: 'Bob' });
    expect(result.success).toBe(true);
  });

  it('accepts sellDate only', () => {
    const result = updateSaleSchema.safeParse({ sellDate: '2026-03-20' });
    expect(result.success).toBe(true);
  });

  it('accepts multiple fields together', () => {
    const result = updateSaleSchema.safeParse({
      oz: 14,
      price: 20,
      buyer: 'Charlie',
      sellDate: '2026-03-22',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (no fields)', () => {
    const result = updateSaleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects all-undefined fields', () => {
    const result = updateSaleSchema.safeParse({
      oz: undefined,
      price: undefined,
      buyer: undefined,
      sellDate: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive oz', () => {
    const result = updateSaleSchema.safeParse({ oz: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = updateSaleSchema.safeParse({ price: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts zero price (free/gift)', () => {
    const result = updateSaleSchema.safeParse({ price: 0 });
    expect(result.success).toBe(true);
  });
});

// ─── deleteSaleSchema ─────────────────────────────────────────────────────────

describe('deleteSaleSchema', () => {
  it('accepts a valid positive integer id', () => {
    const parsed = deleteSaleSchema.parse({ id: 1 });
    expect(parsed.id).toBe(1);
  });

  it('rejects id of 0', () => {
    expect(() => deleteSaleSchema.parse({ id: 0 })).toThrow();
  });

  it('rejects negative id', () => {
    expect(() => deleteSaleSchema.parse({ id: -1 })).toThrow();
  });

  it('rejects non-integer id', () => {
    expect(() => deleteSaleSchema.parse({ id: 1.5 })).toThrow();
  });

  it('rejects missing id', () => {
    const result = deleteSaleSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
