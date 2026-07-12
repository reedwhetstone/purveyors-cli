import { describe, it, expect, vi } from 'vitest';
import {
  listSalesSchema,
  saleTargetSelectorSchema,
  recordSaleSchema,
  updateSaleSchema,
  deleteSaleSchema,
  recordSale,
} from '../src/lib/sales.js';
import { AuthError } from '../src/lib/errors.js';

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

  it('accepts greenCoffeeInvId as positive integer', () => {
    const parsed = listSalesSchema.parse({ greenCoffeeInvId: 42 });
    expect(parsed.greenCoffeeInvId).toBe(42);
  });

  it('rejects non-positive greenCoffeeInvId', () => {
    expect(() => listSalesSchema.parse({ greenCoffeeInvId: 0 })).toThrow();
    expect(() => listSalesSchema.parse({ greenCoffeeInvId: -1 })).toThrow();
  });

  it('rejects non-integer greenCoffeeInvId', () => {
    expect(() => listSalesSchema.parse({ greenCoffeeInvId: 1.5 })).toThrow();
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
    expect(parsed.greenCoffeeInvId).toBeUndefined();
    expect(parsed.dateStart).toBeUndefined();
    expect(parsed.dateEnd).toBeUndefined();
    expect(parsed.buyer).toBeUndefined();
    expect(parsed.offset).toBeUndefined();
  });

  it('accepts offset of 0', () => {
    const parsed = listSalesSchema.parse({ offset: 0 });
    expect(parsed.offset).toBe(0);
  });

  it('accepts positive offset', () => {
    const parsed = listSalesSchema.parse({ offset: 20 });
    expect(parsed.offset).toBe(20);
  });

  it('rejects negative offset', () => {
    expect(() => listSalesSchema.parse({ offset: -1 })).toThrow();
  });

  it('rejects non-integer offset', () => {
    expect(() => listSalesSchema.parse({ offset: 5.5 })).toThrow();
  });

  it('accepts all filters together including offset', () => {
    const parsed = listSalesSchema.parse({
      greenCoffeeInvId: 42,
      dateStart: '2026-01-01',
      dateEnd: '2026-03-31',
      buyer: 'Alice',
      limit: 50,
      offset: 100,
    });
    expect(parsed.greenCoffeeInvId).toBe(42);
    expect(parsed.dateStart).toBe('2026-01-01');
    expect(parsed.dateEnd).toBe('2026-03-31');
    expect(parsed.buyer).toBe('Alice');
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(100);
  });
});

// ─── saleTargetSelectorSchema ────────────────────────────────────────────────

describe('saleTargetSelectorSchema', () => {
  it('accepts exact selector mode', () => {
    const parsed = saleTargetSelectorSchema.parse({ roastId: 42 });
    expect(parsed.roastId).toBe(42);
    expect(parsed.coffeeId).toBeUndefined();
  });

  it('accepts resolved selector mode', () => {
    const parsed = saleTargetSelectorSchema.parse({
      coffeeId: 7,
      batchName: 'Ethiopia Guji Light',
    });
    expect(parsed.coffeeId).toBe(7);
    expect(parsed.batchName).toBe('Ethiopia Guji Light');
  });

  it('rejects missing all selectors', () => {
    const result = saleTargetSelectorSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects incomplete resolved selector mode', () => {
    expect(
      saleTargetSelectorSchema.safeParse({
        coffeeId: 7,
      }).success
    ).toBe(false);
    expect(
      saleTargetSelectorSchema.safeParse({
        batchName: 'Batch A',
      }).success
    ).toBe(false);
  });

  it('rejects mixing exact and resolved selectors', () => {
    const result = saleTargetSelectorSchema.safeParse({
      roastId: 42,
      coffeeId: 7,
      batchName: 'Batch A',
    });
    expect(result.success).toBe(false);
  });
});

// ─── recordSaleSchema ─────────────────────────────────────────────────────────

describe('recordSaleSchema', () => {
  const validExactInput = {
    roastId: 42,
    oz: 12,
    price: 18.5,
  };

  it('accepts valid exact required fields', () => {
    const parsed = recordSaleSchema.parse(validExactInput);
    expect(parsed.roastId).toBe(42);
    expect(parsed.oz).toBe(12);
    expect(parsed.price).toBe(18.5);
  });

  it('accepts resolved selector mode', () => {
    const parsed = recordSaleSchema.parse({
      coffeeId: 7,
      batchName: 'Ethiopia Guji Light',
      oz: 12,
      price: 18.5,
    });
    expect(parsed.coffeeId).toBe(7);
    expect(parsed.batchName).toBe('Ethiopia Guji Light');
  });

  it('accepts optional buyer and sellDate', () => {
    const parsed = recordSaleSchema.parse({
      ...validExactInput,
      buyer: 'Alice',
      sellDate: '2026-03-23',
    });
    expect(parsed.buyer).toBe('Alice');
    expect(parsed.sellDate).toBe('2026-03-23');
  });

  it('rejects missing selector', () => {
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
    expect(() => recordSaleSchema.parse({ ...validExactInput, roastId: 0 })).toThrow();
    expect(() => recordSaleSchema.parse({ ...validExactInput, roastId: -1 })).toThrow();
  });

  it('rejects non-positive coffeeId', () => {
    expect(() =>
      recordSaleSchema.parse({
        coffeeId: 0,
        batchName: 'Batch A',
        oz: 12,
        price: 18,
      })
    ).toThrow();
  });

  it('rejects non-positive oz', () => {
    expect(() => recordSaleSchema.parse({ ...validExactInput, oz: 0 })).toThrow();
    expect(() => recordSaleSchema.parse({ ...validExactInput, oz: -5 })).toThrow();
  });

  it('rejects negative price', () => {
    expect(() => recordSaleSchema.parse({ ...validExactInput, price: -1 })).toThrow();
  });

  it('accepts zero price (free/gift)', () => {
    const parsed = recordSaleSchema.parse({ ...validExactInput, price: 0 });
    expect(parsed.price).toBe(0);
  });

  it('rejects non-integer roastId', () => {
    expect(() => recordSaleSchema.parse({ ...validExactInput, roastId: 3.5 })).toThrow();
  });

  it('rejects mixing exact and resolved selectors', () => {
    expect(() =>
      recordSaleSchema.parse({
        roastId: 42,
        coffeeId: 7,
        batchName: 'Batch A',
        oz: 12,
        price: 18,
      })
    ).toThrow();
  });
});

// ─── recordSale behavior ─────────────────────────────────────────────────────

type QueryCall = {
  method: string;
  args: unknown[];
};

function makeRecordSaleSupabase(
  overrides: {
    roastSingle?: { data?: unknown; error?: unknown };
    roastLookup?: { data?: unknown; error?: unknown };
    insertResult?: { data?: unknown; error?: unknown };
    saleRefetch?: { data?: unknown; error?: unknown };
  } = {}
) {
  const roastCalls: QueryCall[] = [];
  let insertedPayload: Record<string, unknown> | null = null;

  const roastProfilesQuery = {
    eq(field: string, value: unknown) {
      roastCalls.push({ method: 'eq', args: [field, value] });
      return roastProfilesQuery;
    },
    ilike(field: string, value: unknown) {
      roastCalls.push({ method: 'ilike', args: [field, value] });
      return roastProfilesQuery;
    },
    limit(limitValue: number) {
      roastCalls.push({ method: 'limit', args: [limitValue] });
      return Promise.resolve(overrides.roastLookup ?? { data: [{ roast_id: 42 }], error: null });
    },
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(overrides.roastSingle ?? { data: { roast_id: 42 }, error: null })
      ),
  };

  const salesSelectQuery = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() =>
      Promise.resolve(
        overrides.saleRefetch ?? {
          data: {
            id: 55,
            roast_id: 42,
            oz_sold: 12,
            sale_price: 18.5,
            buyer: null,
            sell_date: '2026-04-17',
            user: 'user-123',
            last_updated: '2026-04-17T00:00:00.000Z',
          },
          error: null,
        }
      )
    ),
  };

  const salesTable = {
    insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      insertedPayload = payload;
      return {
        select: vi.fn().mockReturnValue({
          single: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(overrides.insertResult ?? { data: { id: 55 }, error: null })
            ),
        }),
      };
    }),
    select: vi.fn().mockReturnValue(salesSelectQuery),
  };

  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'roast_profiles') {
        return {
          select: vi.fn().mockReturnValue(roastProfilesQuery),
        };
      }

      if (table === 'sales') {
        return salesTable;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase: supabase as never,
    roastCalls,
    salesSelectQuery,
    getInsertedPayload: () => insertedPayload,
  };
}

describe('recordSale', () => {
  it('records a sale via exact roastId selector mode', async () => {
    const harness = makeRecordSaleSupabase();

    const result = await recordSale(harness.supabase, 'user-123', {
      roastId: 42,
      oz: 12,
      price: 18.5,
    });

    expect(result.id).toBe(55);
    expect(harness.getInsertedPayload()).toMatchObject({
      user: 'user-123',
      roast_id: 42,
      oz_sold: 12,
      sale_price: 18.5,
    });
    expect(harness.roastCalls).toContainEqual({ method: 'eq', args: ['roast_id', 42] });
    expect(harness.roastCalls).toContainEqual({ method: 'eq', args: ['user', 'user-123'] });
    expect(harness.roastCalls.find((call) => call.method === 'ilike')).toBeUndefined();
  });

  it('records a sale via resolved coffeeId + batchName selector mode', async () => {
    const harness = makeRecordSaleSupabase({
      roastLookup: { data: [{ roast_id: 99, batch_name: 'Batch A' }], error: null },
      saleRefetch: {
        data: {
          id: 55,
          roast_id: 99,
          oz_sold: 12,
          sale_price: 18.5,
          buyer: 'Alice',
          sell_date: '2026-04-17',
          user: 'user-123',
          last_updated: '2026-04-17T00:00:00.000Z',
        },
        error: null,
      },
    });

    const result = await recordSale(harness.supabase, 'user-123', {
      coffeeId: 7,
      batchName: 'Batch A',
      oz: 12,
      price: 18.5,
      buyer: 'Alice',
    });

    expect(result.roast_id).toBe(99);
    expect(harness.getInsertedPayload()).toMatchObject({
      roast_id: 99,
      buyer: 'Alice',
    });
    expect(harness.roastCalls).toContainEqual({ method: 'eq', args: ['user', 'user-123'] });
    expect(harness.roastCalls).toContainEqual({ method: 'eq', args: ['coffee_id', 7] });
    expect(harness.roastCalls).toContainEqual({ method: 'eq', args: ['batch_name', 'Batch A'] });
    expect(harness.roastCalls.find((call) => call.method === 'ilike')).toBeUndefined();
    expect(harness.roastCalls).toContainEqual({ method: 'limit', args: [2] });
  });

  it('preserves literal batch names during resolved selector lookup', async () => {
    const literalBatchName = 'Batch_(Light).100%';
    const harness = makeRecordSaleSupabase({
      roastLookup: { data: [{ roast_id: 99, batch_name: literalBatchName }], error: null },
      saleRefetch: {
        data: {
          id: 55,
          roast_id: 99,
          oz_sold: 12,
          sale_price: 18.5,
          buyer: null,
          sell_date: '2026-04-17',
          user: 'user-123',
          last_updated: '2026-04-17T00:00:00.000Z',
        },
        error: null,
      },
    });

    await recordSale(harness.supabase, 'user-123', {
      coffeeId: 7,
      batchName: literalBatchName,
      oz: 12,
      price: 18.5,
    });

    expect(harness.roastCalls).toContainEqual({
      method: 'eq',
      args: ['batch_name', literalBatchName],
    });
    expect(harness.roastCalls.find((call) => call.method === 'ilike')).toBeUndefined();
  });

  it('throws NOT_FOUND when resolved selector mode matches no roasts', async () => {
    const harness = makeRecordSaleSupabase({
      roastLookup: { data: [], error: null },
    });

    await expect(
      recordSale(harness.supabase, 'user-123', {
        coffeeId: 7,
        batchName: 'Missing Batch',
        oz: 12,
        price: 18.5,
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws INVALID_ARGUMENT when resolved selector mode is ambiguous', async () => {
    const harness = makeRecordSaleSupabase({
      roastLookup: {
        data: [
          { roast_id: 91, batch_name: 'Batch A' },
          { roast_id: 92, batch_name: 'Batch A' },
        ],
        error: null,
      },
    });

    await expect(
      recordSale(harness.supabase, 'user-123', {
        coffeeId: 7,
        batchName: 'Batch A',
        oz: 12,
        price: 18.5,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('throws AuthError when exact roastId does not belong to the user', async () => {
    const harness = makeRecordSaleSupabase({
      roastSingle: { data: null, error: { message: 'not found' } },
    });

    await expect(
      recordSale(harness.supabase, 'user-123', {
        roastId: 42,
        oz: 12,
        price: 18.5,
      })
    ).rejects.toThrow(AuthError);
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
