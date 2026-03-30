import { describe, it, expect } from 'vitest';
import {
  listInventorySchema,
  getInventorySchema,
  addInventorySchema,
  updateInventorySchema,
  deleteInventorySchema,
} from '../src/lib/inventory.js';

// ─── listInventorySchema ──────────────────────────────────────────────────────

describe('listInventorySchema', () => {
  it('applies default limit of 20', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.limit).toBe(20);
  });

  it('accepts a custom limit', () => {
    const parsed = listInventorySchema.parse({ limit: 50 });
    expect(parsed.limit).toBe(50);
  });

  it('accepts stocked_only flag', () => {
    const parsed = listInventorySchema.parse({ stocked_only: true });
    expect(parsed.stocked_only).toBe(true);
  });

  it('accepts stocked_only as false', () => {
    const parsed = listInventorySchema.parse({ stocked_only: false });
    expect(parsed.stocked_only).toBe(false);
  });

  it('stocked_only defaults to undefined when omitted', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.stocked_only).toBeUndefined();
  });

  it('rejects limit of 0', () => {
    expect(() => listInventorySchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects negative limit', () => {
    expect(() => listInventorySchema.parse({ limit: -1 })).toThrow();
  });

  it('rejects non-integer limit', () => {
    expect(() => listInventorySchema.parse({ limit: 5.5 })).toThrow();
  });

  it('accepts catalogId filter', () => {
    const parsed = listInventorySchema.parse({ catalogId: 128 });
    expect(parsed.catalogId).toBe(128);
  });

  it('catalogId defaults to undefined when omitted', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.catalogId).toBeUndefined();
  });

  it('rejects non-positive catalogId', () => {
    expect(() => listInventorySchema.parse({ catalogId: 0 })).toThrow();
    expect(() => listInventorySchema.parse({ catalogId: -1 })).toThrow();
  });

  it('rejects non-integer catalogId', () => {
    expect(() => listInventorySchema.parse({ catalogId: 1.5 })).toThrow();
  });

  it('accepts purchaseDateStart filter', () => {
    const parsed = listInventorySchema.parse({ purchaseDateStart: '2026-01-01' });
    expect(parsed.purchaseDateStart).toBe('2026-01-01');
  });

  it('accepts purchaseDateEnd filter', () => {
    const parsed = listInventorySchema.parse({ purchaseDateEnd: '2026-03-31' });
    expect(parsed.purchaseDateEnd).toBe('2026-03-31');
  });

  it('purchaseDateStart defaults to undefined when omitted', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.purchaseDateStart).toBeUndefined();
  });

  it('purchaseDateEnd defaults to undefined when omitted', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.purchaseDateEnd).toBeUndefined();
  });

  it('accepts origin filter', () => {
    const parsed = listInventorySchema.parse({ origin: 'Ethiopia' });
    expect(parsed.origin).toBe('Ethiopia');
  });

  it('origin defaults to undefined when omitted', () => {
    const parsed = listInventorySchema.parse({});
    expect(parsed.origin).toBeUndefined();
  });

  it('accepts all four new filters together', () => {
    const parsed = listInventorySchema.parse({
      catalogId: 42,
      purchaseDateStart: '2026-01-01',
      purchaseDateEnd: '2026-03-31',
      origin: 'Colombia',
    });
    expect(parsed.catalogId).toBe(42);
    expect(parsed.purchaseDateStart).toBe('2026-01-01');
    expect(parsed.purchaseDateEnd).toBe('2026-03-31');
    expect(parsed.origin).toBe('Colombia');
  });

  it('accepts filters combined with stocked_only and custom limit', () => {
    const parsed = listInventorySchema.parse({
      stocked_only: true,
      limit: 10,
      catalogId: 128,
      origin: 'Kenya',
    });
    expect(parsed.stocked_only).toBe(true);
    expect(parsed.limit).toBe(10);
    expect(parsed.catalogId).toBe(128);
    expect(parsed.origin).toBe('Kenya');
  });
});

// ─── getInventorySchema ───────────────────────────────────────────────────────

describe('getInventorySchema', () => {
  it('accepts a valid positive integer id', () => {
    const parsed = getInventorySchema.parse({ id: 1 });
    expect(parsed.id).toBe(1);
  });

  it('rejects id of 0', () => {
    expect(() => getInventorySchema.parse({ id: 0 })).toThrow();
  });

  it('rejects negative id', () => {
    expect(() => getInventorySchema.parse({ id: -1 })).toThrow();
  });

  it('rejects non-integer id', () => {
    expect(() => getInventorySchema.parse({ id: 2.5 })).toThrow();
  });

  it('rejects missing id', () => {
    const result = getInventorySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── addInventorySchema ───────────────────────────────────────────────────────

describe('addInventorySchema', () => {
  const validInput = {
    catalogId: 128,
    qty: 5,
  };

  it('accepts valid required fields', () => {
    const parsed = addInventorySchema.parse(validInput);
    expect(parsed.catalogId).toBe(128);
    expect(parsed.qty).toBe(5);
  });

  it('accepts all optional fields', () => {
    const parsed = addInventorySchema.parse({
      ...validInput,
      cost: 45.0,
      taxShip: 8.5,
      notes: 'Great Ethiopian natural',
      purchaseDate: '2026-03-23',
    });
    expect(parsed.cost).toBe(45.0);
    expect(parsed.taxShip).toBe(8.5);
    expect(parsed.notes).toBe('Great Ethiopian natural');
    expect(parsed.purchaseDate).toBe('2026-03-23');
  });

  it('rejects missing catalogId', () => {
    const result = addInventorySchema.safeParse({ qty: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing qty', () => {
    const result = addInventorySchema.safeParse({ catalogId: 128 });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive catalogId', () => {
    expect(() => addInventorySchema.parse({ ...validInput, catalogId: 0 })).toThrow();
    expect(() => addInventorySchema.parse({ ...validInput, catalogId: -1 })).toThrow();
  });

  it('rejects non-integer catalogId', () => {
    expect(() => addInventorySchema.parse({ ...validInput, catalogId: 1.5 })).toThrow();
  });

  it('rejects non-positive qty', () => {
    expect(() => addInventorySchema.parse({ ...validInput, qty: 0 })).toThrow();
    expect(() => addInventorySchema.parse({ ...validInput, qty: -3 })).toThrow();
  });

  it('accepts fractional qty (lbs can be decimal)', () => {
    const parsed = addInventorySchema.parse({ ...validInput, qty: 2.5 });
    expect(parsed.qty).toBe(2.5);
  });
});

// ─── updateInventorySchema ────────────────────────────────────────────────────

describe('updateInventorySchema', () => {
  it('accepts qty only', () => {
    const result = updateInventorySchema.safeParse({ qty: 10 });
    expect(result.success).toBe(true);
  });

  it('accepts cost only', () => {
    const result = updateInventorySchema.safeParse({ cost: 55.0 });
    expect(result.success).toBe(true);
  });

  it('accepts taxShip only', () => {
    const result = updateInventorySchema.safeParse({ taxShip: 12.0 });
    expect(result.success).toBe(true);
  });

  it('accepts notes only', () => {
    const result = updateInventorySchema.safeParse({ notes: 'Updated cupping notes' });
    expect(result.success).toBe(true);
  });

  it('accepts stocked only', () => {
    const result = updateInventorySchema.safeParse({ stocked: false });
    expect(result.success).toBe(true);
  });

  it('accepts multiple fields together', () => {
    const result = updateInventorySchema.safeParse({
      qty: 8,
      cost: 40,
      notes: 'Restocked',
      stocked: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (no fields)', () => {
    const result = updateInventorySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects all-undefined fields', () => {
    const result = updateInventorySchema.safeParse({
      qty: undefined,
      cost: undefined,
      taxShip: undefined,
      notes: undefined,
      stocked: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive qty', () => {
    const result = updateInventorySchema.safeParse({ qty: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative qty', () => {
    const result = updateInventorySchema.safeParse({ qty: -2 });
    expect(result.success).toBe(false);
  });

  it('accepts fractional qty', () => {
    const result = updateInventorySchema.safeParse({ qty: 3.75 });
    expect(result.success).toBe(true);
  });
});

// ─── deleteInventorySchema ────────────────────────────────────────────────────

describe('deleteInventorySchema', () => {
  it('accepts a valid positive integer id', () => {
    const parsed = deleteInventorySchema.parse({ id: 5 });
    expect(parsed.id).toBe(5);
  });

  it('rejects id of 0', () => {
    expect(() => deleteInventorySchema.parse({ id: 0 })).toThrow();
  });

  it('rejects negative id', () => {
    expect(() => deleteInventorySchema.parse({ id: -1 })).toThrow();
  });

  it('rejects non-integer id', () => {
    expect(() => deleteInventorySchema.parse({ id: 3.7 })).toThrow();
  });

  it('rejects missing id', () => {
    const result = deleteInventorySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
