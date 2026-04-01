import { describe, it, expect } from 'vitest';
import {
  listSalesSchema,
  recordSaleSchema,
  updateSaleSchema,
  deleteSaleSchema,
  listSales,
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

// ─── listSales query builder ──────────────────────────────────────────────────

type QueryCall = {
  method: string;
  args: unknown[];
};

function createSalesQuery(result: unknown[]) {
  const calls: QueryCall[] = [];

  const query = {
    eq(field: string, value: unknown) {
      calls.push({ method: 'eq', args: [field, value] });
      return query;
    },
    ilike(field: string, value: unknown) {
      calls.push({ method: 'ilike', args: [field, value] });
      return query;
    },
    gte(field: string, value: unknown) {
      calls.push({ method: 'gte', args: [field, value] });
      return query;
    },
    lte(field: string, value: unknown) {
      calls.push({ method: 'lte', args: [field, value] });
      return query;
    },
    order(field: string, options: unknown) {
      calls.push({ method: 'order', args: [field, options] });
      return query;
    },
    limit(limitValue: number) {
      calls.push({ method: 'limit', args: [limitValue] });
      return Promise.resolve({ data: result, error: null });
    },
  };

  return { query, calls };
}

function createSupabaseForSalesList(result: unknown[] = []) {
  const salesQuery = createSalesQuery(result);

  const supabase = {
    from(table: string) {
      if (table !== 'sales') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select(_columns: string) {
          return salesQuery.query;
        },
      };
    },
  } as unknown as Parameters<typeof listSales>[0];

  return { supabase, salesQuery };
}

describe('listSales query builder', () => {
  it('always filters by user', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    expect(salesQuery.calls).toContainEqual({ method: 'eq', args: ['user', 'user-abc'] });
  });

  it('applies roastId as an exact eq filter', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([{ id: 1, roast_id: 42 }]);
    await listSales(supabase, 'user-abc', { roastId: 42 });
    expect(salesQuery.calls).toContainEqual({ method: 'eq', args: ['roast_id', 42] });
  });

  it('does NOT add roastId eq when roastId is omitted', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    const roastIdEqs = salesQuery.calls.filter(
      (c) => c.method === 'eq' && (c.args as unknown[])[0] === 'roast_id'
    );
    expect(roastIdEqs).toHaveLength(0);
  });

  it('applies dateStart as gte filter', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', { dateStart: '2026-01-01' });
    expect(salesQuery.calls).toContainEqual({ method: 'gte', args: ['sell_date', '2026-01-01'] });
  });

  it('applies dateEnd as lte filter', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', { dateEnd: '2026-03-31' });
    expect(salesQuery.calls).toContainEqual({ method: 'lte', args: ['sell_date', '2026-03-31'] });
  });

  it('does NOT add date filters when date fields are omitted', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    const dateCalls = salesQuery.calls.filter((c) => c.method === 'gte' || c.method === 'lte');
    expect(dateCalls).toHaveLength(0);
  });

  it('applies buyer as ilike filter', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', { buyer: 'Alice' });
    expect(salesQuery.calls).toContainEqual({
      method: 'ilike',
      args: ['buyer', '%Alice%'],
    });
  });

  it('does NOT add ilike filter when buyer is omitted', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    const ilikeCalls = salesQuery.calls.filter((c) => c.method === 'ilike');
    expect(ilikeCalls).toHaveLength(0);
  });

  it('applies all filters together', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {
      roastId: 7,
      dateStart: '2026-01-01',
      dateEnd: '2026-03-31',
      buyer: 'Bob',
    });
    expect(salesQuery.calls).toContainEqual({ method: 'eq', args: ['roast_id', 7] });
    expect(salesQuery.calls).toContainEqual({ method: 'gte', args: ['sell_date', '2026-01-01'] });
    expect(salesQuery.calls).toContainEqual({ method: 'lte', args: ['sell_date', '2026-03-31'] });
    expect(salesQuery.calls).toContainEqual({ method: 'ilike', args: ['buyer', '%Bob%'] });
  });

  it('orders by sell_date descending', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    expect(salesQuery.calls).toContainEqual({
      method: 'order',
      args: ['sell_date', { ascending: false }],
    });
  });

  it('applies the default limit of 20', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', {});
    expect(salesQuery.calls).toContainEqual({ method: 'limit', args: [20] });
  });

  it('applies a custom limit', async () => {
    const { supabase, salesQuery } = createSupabaseForSalesList([]);
    await listSales(supabase, 'user-abc', { limit: 5 });
    expect(salesQuery.calls).toContainEqual({ method: 'limit', args: [5] });
  });

  it('returns the data rows from the query result', async () => {
    const mockSale = { id: 1, roast_id: 42, oz_sold: 12 };
    const { supabase } = createSupabaseForSalesList([mockSale]);
    const result = await listSales(supabase, 'user-abc', {});
    expect(result).toEqual([mockSale]);
  });

  it('returns empty array when no sales match', async () => {
    const { supabase } = createSupabaseForSalesList([]);
    const result = await listSales(supabase, 'user-abc', { roastId: 999 });
    expect(result).toEqual([]);
  });
});
