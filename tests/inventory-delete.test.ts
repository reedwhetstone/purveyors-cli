import { describe, it, expect, vi } from 'vitest';
import { deleteInventory } from '../src/lib/inventory.js';
import { PrvrsError, AuthError } from '../src/lib/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Supabase mock. Each `.from()` call chains `.select()`,
 * `.eq()`, `.delete()`, and `.single()`. We intercept at `.single()` or
 * the final `await` depending on the query type.
 *
 * The factory accepts per-table response overrides so individual tests can
 * control what each table returns.
 */
function makeSupabase(overrides: {
  green_coffee_inv?: { data?: unknown; error?: unknown };
  roast_profiles_count?: { count: number | null; error?: unknown };
  sales_count?: { count: number | null; error?: unknown };
  roast_profiles_delete?: { error?: unknown };
  sales_delete?: { error?: unknown };
  green_coffee_inv_delete?: { error?: unknown };
}) {
  // Track which table is currently being queried
  let currentTable = '';
  let isCountQuery = false;
  let isDeleteQuery = false;

  const chain = {
    select: vi
      .fn()
      .mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
        isCountQuery = !!opts?.count;
        return chain;
      }),
    eq: vi.fn().mockReturnThis(),
    delete: vi.fn().mockImplementation(() => {
      isDeleteQuery = true;
      return chain;
    }),
    single: vi.fn().mockImplementation(() => {
      return overrides.green_coffee_inv ?? { data: { id: 1 }, error: null };
    }),
    // Allow awaiting the chain directly (for count queries and delete queries)
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      if (isDeleteQuery) {
        const key = `${currentTable}_delete` as keyof typeof overrides;
        const resp = overrides[key] as { error?: unknown } | undefined;
        isDeleteQuery = false;
        resolve(resp ?? { error: null });
        return;
      }
      if (isCountQuery) {
        if (currentTable === 'roast_profiles') {
          resolve(overrides.roast_profiles_count ?? { count: 0, error: null });
        } else if (currentTable === 'sales') {
          resolve(overrides.sales_count ?? { count: 0, error: null });
        } else {
          resolve({ count: 0, error: null });
        }
        isCountQuery = false;
        return;
      }
      resolve({ data: null, error: null });
    }),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      currentTable = table;
      isCountQuery = false;
      isDeleteQuery = false;
      return chain;
    }),
  };
}

// ─── deleteInventory — happy path (no dependencies) ──────────────────────────

describe('deleteInventory — no dependencies', () => {
  it('deletes successfully and returns zero counts', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 7 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 0, error: null },
      green_coffee_inv_delete: { error: null },
    });

    const result = await deleteInventory(supabase as never, 'user-1', 7);

    expect(result.deletedInventoryId).toBe(7);
    expect(result.deletedRoasts).toBe(0);
    expect(result.deletedSales).toBe(0);
  });

  it('does not call roast or sales delete when there are no dependents', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 7 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 0, error: null },
      green_coffee_inv_delete: { error: null },
    });

    await deleteInventory(supabase as never, 'user-1', 7);

    // roast_profiles and sales should only have been queried for counts,
    // never for deletion
    const calls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    );
    // delete was called on green_coffee_inv; roast_profiles and sales are
    // referenced for count checks only
    const deleteCalls = calls.filter((t: string) => t !== 'green_coffee_inv');
    // Both count tables were queried
    expect(calls).toContain('roast_profiles');
    expect(calls).toContain('sales');
    // roast_profiles and sales should not appear a second time (no delete)
    const roastCount = calls.filter((t: string) => t === 'roast_profiles').length;
    const salesCount = calls.filter((t: string) => t === 'sales').length;
    expect(roastCount).toBe(1); // count query only
    expect(salesCount).toBe(1); // count query only
    void deleteCalls;
  });
});

// ─── deleteInventory — DEPENDENCY_CONFLICT (no force) ────────────────────────

describe('deleteInventory — DEPENDENCY_CONFLICT', () => {
  it('throws DEPENDENCY_CONFLICT when roast_profiles count > 0', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 2, error: null },
      sales_count: { count: 0, error: null },
    });

    await expect(deleteInventory(supabase as never, 'user-1', 5)).rejects.toMatchObject({
      code: 'DEPENDENCY_CONFLICT',
    });
  });

  it('error message includes roast profile count', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 2, error: null },
      sales_count: { count: 0, error: null },
    });

    let caught: PrvrsError | undefined;
    try {
      await deleteInventory(supabase as never, 'user-1', 5);
    } catch (e) {
      caught = e as PrvrsError;
    }
    expect(caught).toBeInstanceOf(PrvrsError);
    expect(caught?.message).toContain('2 roast profiles');
    expect(caught?.message).toContain('--force');
  });

  it('throws DEPENDENCY_CONFLICT when sales count > 0', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 3, error: null },
    });

    await expect(deleteInventory(supabase as never, 'user-1', 5)).rejects.toMatchObject({
      code: 'DEPENDENCY_CONFLICT',
    });
  });

  it('error message includes sale record count', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 3, error: null },
    });

    let caught: PrvrsError | undefined;
    try {
      await deleteInventory(supabase as never, 'user-1', 5);
    } catch (e) {
      caught = e as PrvrsError;
    }
    expect(caught?.message).toContain('3 sale records');
  });

  it('error message includes both counts when both are non-zero', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 1, error: null },
      sales_count: { count: 1, error: null },
    });

    let caught: PrvrsError | undefined;
    try {
      await deleteInventory(supabase as never, 'user-1', 5);
    } catch (e) {
      caught = e as PrvrsError;
    }
    expect(caught?.message).toContain('1 roast profile');
    expect(caught?.message).toContain('1 sale record');
  });

  it('uses singular "profile" for count of 1', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: 1, error: null },
      sales_count: { count: 0, error: null },
    });

    let caught: PrvrsError | undefined;
    try {
      await deleteInventory(supabase as never, 'user-1', 5);
    } catch (e) {
      caught = e as PrvrsError;
    }
    expect(caught?.message).toContain('1 roast profile');
    expect(caught?.message).not.toContain('profiles');
  });
});

// ─── deleteInventory — force path ────────────────────────────────────────────

describe('deleteInventory — force: true', () => {
  it('returns correct deleted counts when force=true with roast dependents', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 10 }, error: null },
      roast_profiles_count: { count: 3, error: null },
      sales_count: { count: 0, error: null },
      roast_profiles_delete: { error: null },
      green_coffee_inv_delete: { error: null },
    });

    const result = await deleteInventory(supabase as never, 'user-1', 10, { force: true });

    expect(result.deletedInventoryId).toBe(10);
    expect(result.deletedRoasts).toBe(3);
    expect(result.deletedSales).toBe(0);
  });

  it('returns correct deleted counts when force=true with sales dependents', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 10 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 2, error: null },
      sales_delete: { error: null },
      green_coffee_inv_delete: { error: null },
    });

    const result = await deleteInventory(supabase as never, 'user-1', 10, { force: true });

    expect(result.deletedRoasts).toBe(0);
    expect(result.deletedSales).toBe(2);
  });

  it('returns correct deleted counts when force=true with both dependents', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 10 }, error: null },
      roast_profiles_count: { count: 4, error: null },
      sales_count: { count: 2, error: null },
      sales_delete: { error: null },
      roast_profiles_delete: { error: null },
      green_coffee_inv_delete: { error: null },
    });

    const result = await deleteInventory(supabase as never, 'user-1', 10, { force: true });

    expect(result.deletedRoasts).toBe(4);
    expect(result.deletedSales).toBe(2);
    expect(result.deletedInventoryId).toBe(10);
  });

  it('succeeds with force=true even when no dependents exist', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 10 }, error: null },
      roast_profiles_count: { count: 0, error: null },
      sales_count: { count: 0, error: null },
      green_coffee_inv_delete: { error: null },
    });

    const result = await deleteInventory(supabase as never, 'user-1', 10, { force: true });

    expect(result.deletedRoasts).toBe(0);
    expect(result.deletedSales).toBe(0);
  });
});

// ─── deleteInventory — ownership check ───────────────────────────────────────

describe('deleteInventory — ownership check', () => {
  it('throws AuthError when item does not belong to user', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: null, error: { code: 'PGRST116', message: 'not found' } },
    });

    await expect(deleteInventory(supabase as never, 'user-1', 99)).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it('throws AuthError when data is null even with no error', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: null, error: null },
    });

    await expect(deleteInventory(supabase as never, 'user-1', 99)).rejects.toBeInstanceOf(
      AuthError
    );
  });
});
