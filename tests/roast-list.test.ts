import { describe, it, expect } from 'vitest';
import { listRoasts, listRoastsSchema } from '../src/lib/roast.js';

describe('listRoastsSchema', () => {
  // ── Existing fields ────────────────────────────────────────────────────────

  it('accepts empty object (all defaults)', () => {
    const result = listRoastsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.coffee_id).toBeUndefined();
      expect(result.data.roast_id).toBeUndefined();
      expect(result.data.batch_name).toBeUndefined();
      expect(result.data.date_start).toBeUndefined();
      expect(result.data.date_end).toBeUndefined();
      expect(result.data.stocked_only).toBeUndefined();
      expect(result.data.catalog_id).toBeUndefined();
    }
  });

  it('accepts coffee_id filter', () => {
    const result = listRoastsSchema.safeParse({ coffee_id: 7 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.coffee_id).toBe(7);
  });

  it('rejects non-positive coffee_id', () => {
    expect(listRoastsSchema.safeParse({ coffee_id: 0 }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ coffee_id: -1 }).success).toBe(false);
  });

  it('accepts roast_id filter', () => {
    const result = listRoastsSchema.safeParse({ roast_id: 123 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.roast_id).toBe(123);
  });

  it('rejects non-positive roast_id', () => {
    expect(listRoastsSchema.safeParse({ roast_id: 0 }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ roast_id: -1 }).success).toBe(false);
  });

  it('rejects non-integer roast_id', () => {
    expect(listRoastsSchema.safeParse({ roast_id: 1.5 }).success).toBe(false);
  });

  it('accepts custom limit', () => {
    const result = listRoastsSchema.safeParse({ limit: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(5);
  });

  it('rejects zero limit', () => {
    expect(listRoastsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  // ── batch_name ─────────────────────────────────────────────────────────────

  it('accepts batch_name string', () => {
    const result = listRoastsSchema.safeParse({ batch_name: 'Ethiopia Guji' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.batch_name).toBe('Ethiopia Guji');
  });

  it('accepts empty string batch_name', () => {
    const result = listRoastsSchema.safeParse({ batch_name: '' });
    expect(result.success).toBe(true);
  });

  // ── date_start / date_end ──────────────────────────────────────────────────

  it('accepts valid date_start', () => {
    const result = listRoastsSchema.safeParse({ date_start: '2026-03-01' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date_start).toBe('2026-03-01');
  });

  it('accepts valid date_end', () => {
    const result = listRoastsSchema.safeParse({ date_end: '2026-03-31' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date_end).toBe('2026-03-31');
  });

  it('accepts date range (both start and end)', () => {
    const result = listRoastsSchema.safeParse({
      date_start: '2026-03-01',
      date_end: '2026-03-31',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date_start).toBe('2026-03-01');
      expect(result.data.date_end).toBe('2026-03-31');
    }
  });

  it('rejects non-date string for date_start', () => {
    expect(listRoastsSchema.safeParse({ date_start: 'march first' }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ date_start: '03/01/2026' }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ date_start: '2026-3-1' }).success).toBe(false);
  });

  it('rejects non-date string for date_end', () => {
    expect(listRoastsSchema.safeParse({ date_end: 'last tuesday' }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ date_end: '2026/03/31' }).success).toBe(false);
  });

  // ── stocked_only ───────────────────────────────────────────────────────────

  it('accepts stocked_only true', () => {
    const result = listRoastsSchema.safeParse({ stocked_only: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stocked_only).toBe(true);
  });

  it('accepts stocked_only false', () => {
    const result = listRoastsSchema.safeParse({ stocked_only: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stocked_only).toBe(false);
  });

  it('stocked_only defaults to undefined (not applied)', () => {
    const result = listRoastsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stocked_only).toBeUndefined();
  });

  // ── catalog_id ─────────────────────────────────────────────────────────────

  it('accepts valid catalog_id', () => {
    const result = listRoastsSchema.safeParse({ catalog_id: 128 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.catalog_id).toBe(128);
  });

  it('rejects non-positive catalog_id', () => {
    expect(listRoastsSchema.safeParse({ catalog_id: 0 }).success).toBe(false);
    expect(listRoastsSchema.safeParse({ catalog_id: -1 }).success).toBe(false);
  });

  it('rejects non-integer catalog_id', () => {
    expect(listRoastsSchema.safeParse({ catalog_id: 1.5 }).success).toBe(false);
  });

  // ── coffee_name ────────────────────────────────────────────────────────────

  it('accepts coffee_name string', () => {
    const result = listRoastsSchema.safeParse({ coffee_name: 'Ethiopia Yirgacheffe' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.coffee_name).toBe('Ethiopia Yirgacheffe');
  });

  it('accepts empty string coffee_name', () => {
    const result = listRoastsSchema.safeParse({ coffee_name: '' });
    expect(result.success).toBe(true);
  });

  it('coffee_name defaults to undefined', () => {
    const result = listRoastsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.coffee_name).toBeUndefined();
  });

  // ── Combined filters ──────────────────────────────────────────────────────

  it('accepts all filters together', () => {
    const result = listRoastsSchema.safeParse({
      coffee_id: 7,
      roast_id: 123,
      batch_name: 'Ethiopia',
      coffee_name: 'Ethiopia Yirgacheffe',
      date_start: '2026-03-01',
      date_end: '2026-03-31',
      stocked_only: true,
      catalog_id: 128,
      limit: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coffee_id).toBe(7);
      expect(result.data.roast_id).toBe(123);
      expect(result.data.batch_name).toBe('Ethiopia');
      expect(result.data.coffee_name).toBe('Ethiopia Yirgacheffe');
      expect(result.data.date_start).toBe('2026-03-01');
      expect(result.data.date_end).toBe('2026-03-31');
      expect(result.data.stocked_only).toBe(true);
      expect(result.data.catalog_id).toBe(128);
      expect(result.data.limit).toBe(10);
    }
  });

  it('accepts batch_name + date range without other filters', () => {
    const result = listRoastsSchema.safeParse({
      batch_name: 'Colombia',
      date_start: '2026-01-01',
    });
    expect(result.success).toBe(true);
  });

  // ── offset ────────────────────────────────────────────────────────────────

  it('offset defaults to undefined when omitted', () => {
    const result = listRoastsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBeUndefined();
  });

  it('accepts offset of 0', () => {
    const result = listRoastsSchema.safeParse({ offset: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(0);
  });

  it('accepts positive offset', () => {
    const result = listRoastsSchema.safeParse({ offset: 20 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(20);
  });

  it('rejects negative offset', () => {
    expect(listRoastsSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it('rejects non-integer offset', () => {
    expect(listRoastsSchema.safeParse({ offset: 5.5 }).success).toBe(false);
  });

  it('accepts offset combined with limit and filters', () => {
    const result = listRoastsSchema.safeParse({
      limit: 10,
      offset: 20,
      stocked_only: true,
      coffee_name: 'Ethiopia',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
      expect(result.data.stocked_only).toBe(true);
      expect(result.data.coffee_name).toBe('Ethiopia');
    }
  });
});

type QueryCall = {
  method: string;
  args: unknown[];
};

function createRoastProfilesQuery(result: unknown[]) {
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
    in(field: string, value: unknown) {
      calls.push({ method: 'in', args: [field, value] });
      return query;
    },
    order(field: string, options: unknown) {
      calls.push({ method: 'order', args: [field, options] });
      return query;
    },
    range(from: number, to: number) {
      calls.push({ method: 'range', args: [from, to] });
      return Promise.resolve({ data: result, error: null });
    },
    limit(limitValue: number) {
      calls.push({ method: 'limit', args: [limitValue] });
      return Promise.resolve({ data: result, error: null });
    },
  };

  return { query, calls };
}

function createSupabaseForRoastList(result: unknown[] = []) {
  const roastProfiles = createRoastProfilesQuery(result);

  const supabase = {
    from(table: string) {
      if (table !== 'roast_profiles') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select(_columns: string) {
          return roastProfiles.query;
        },
      };
    },
  } as unknown as Parameters<typeof listRoasts>[0];

  return { supabase, roastProfiles };
}

describe('listRoasts', () => {
  it('applies roast_id as an exact server-side filter', async () => {
    const { supabase, roastProfiles } = createSupabaseForRoastList([{ roast_id: 123 }]);

    const data = await listRoasts(supabase, 'user-123', {
      roast_id: 123,
      limit: 1,
    });

    expect(data).toEqual([{ roast_id: 123 }]);
    expect(roastProfiles.calls).toContainEqual({ method: 'eq', args: ['user', 'user-123'] });
    expect(roastProfiles.calls).toContainEqual({ method: 'eq', args: ['roast_id', 123] });
    expect(roastProfiles.calls).toContainEqual({
      method: 'order',
      args: ['roast_date', { ascending: false }],
    });
    expect(roastProfiles.calls).toContainEqual({ method: 'range', args: [0, 0] });
  });

  it('returns an empty array when roast_id matches no roast', async () => {
    const { supabase, roastProfiles } = createSupabaseForRoastList([]);

    const data = await listRoasts(supabase, 'user-123', {
      roast_id: 999999,
      limit: 1,
    });

    expect(data).toEqual([]);
    expect(roastProfiles.calls).toContainEqual({ method: 'eq', args: ['roast_id', 999999] });
  });

  it('applies coffee_name as an ilike server-side filter', async () => {
    const mockRow = { roast_id: 42, coffee_name: 'Ethiopia Yirgacheffe' };
    const { supabase, roastProfiles } = createSupabaseForRoastList([mockRow]);

    const data = await listRoasts(supabase, 'user-123', {
      coffee_name: 'Ethiopia',
    });

    expect(data).toEqual([mockRow]);
    expect(roastProfiles.calls).toContainEqual({
      method: 'ilike',
      args: ['coffee_name', '%Ethiopia%'],
    });
  });

  it('does NOT add ilike filter when coffee_name is omitted', async () => {
    const { supabase, roastProfiles } = createSupabaseForRoastList([]);

    await listRoasts(supabase, 'user-123', {});

    const ilikeCalls = roastProfiles.calls.filter((c) => c.method === 'ilike');
    expect(ilikeCalls).toHaveLength(0);
  });

  it('returns empty array when coffee_name matches nothing', async () => {
    const { supabase, roastProfiles } = createSupabaseForRoastList([]);

    const data = await listRoasts(supabase, 'user-123', {
      coffee_name: 'nonexistent-bean-xyz',
    });

    expect(data).toEqual([]);
    expect(roastProfiles.calls).toContainEqual({
      method: 'ilike',
      args: ['coffee_name', '%nonexistent-bean-xyz%'],
    });
  });

  it('applies coffee_name ilike independently of batch_name ilike', async () => {
    const { supabase, roastProfiles } = createSupabaseForRoastList([]);

    await listRoasts(supabase, 'user-123', {
      batch_name: 'Light Roast',
      coffee_name: 'Guji',
    });

    expect(roastProfiles.calls).toContainEqual({
      method: 'ilike',
      args: ['batch_name', '%Light Roast%'],
    });
    expect(roastProfiles.calls).toContainEqual({
      method: 'ilike',
      args: ['coffee_name', '%Guji%'],
    });
  });
});
