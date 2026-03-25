import { describe, it, expect } from 'vitest';
import { listRoastsSchema } from '../src/lib/roast.js';

describe('listRoastsSchema', () => {
  // ── Existing fields ────────────────────────────────────────────────────────

  it('accepts empty object (all defaults)', () => {
    const result = listRoastsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.coffee_id).toBeUndefined();
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

  // ── Combined filters ──────────────────────────────────────────────────────

  it('accepts all filters together', () => {
    const result = listRoastsSchema.safeParse({
      coffee_id: 7,
      batch_name: 'Ethiopia',
      date_start: '2026-03-01',
      date_end: '2026-03-31',
      stocked_only: true,
      catalog_id: 128,
      limit: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coffee_id).toBe(7);
      expect(result.data.batch_name).toBe('Ethiopia');
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
});
