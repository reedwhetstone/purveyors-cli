import { describe, it, expect } from 'vitest';
import { importRoastSchema, extractOzFromAlog, defaultBatchName } from '../src/lib/roast.js';

// ── importRoastSchema ─────────────────────────────────────────────────────────

describe('importRoastSchema', () => {
  const validInput = {
    fileContent: "{'title': 'Test', 'mode': 'F'}",
    fileName: 'test.alog',
    coffeeId: 42,
  };

  it('accepts a minimal valid input', () => {
    const result = importRoastSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = importRoastSchema.safeParse({
      ...validInput,
      batchName: 'My Special Batch',
      ozIn: 16.5,
      roastNotes: 'Light roast, nice and fruity',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchName).toBe('My Special Batch');
      expect(result.data.ozIn).toBe(16.5);
      expect(result.data.roastNotes).toBe('Light roast, nice and fruity');
    }
  });

  it('rejects missing fileContent', () => {
    const result = importRoastSchema.safeParse({ ...validInput, fileContent: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects empty fileContent', () => {
    const result = importRoastSchema.safeParse({ ...validInput, fileContent: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fileName', () => {
    const result = importRoastSchema.safeParse({ ...validInput, fileName: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects empty fileName', () => {
    const result = importRoastSchema.safeParse({ ...validInput, fileName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing coffeeId', () => {
    const result = importRoastSchema.safeParse({ ...validInput, coffeeId: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer coffeeId', () => {
    const result = importRoastSchema.safeParse({ ...validInput, coffeeId: 3.5 });
    expect(result.success).toBe(false);
  });

  it('rejects zero coffeeId', () => {
    const result = importRoastSchema.safeParse({ ...validInput, coffeeId: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative coffeeId', () => {
    const result = importRoastSchema.safeParse({ ...validInput, coffeeId: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive ozIn', () => {
    const result = importRoastSchema.safeParse({ ...validInput, ozIn: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative ozIn', () => {
    const result = importRoastSchema.safeParse({ ...validInput, ozIn: -5 });
    expect(result.success).toBe(false);
  });

  it('allows ozIn to be omitted', () => {
    const result = importRoastSchema.safeParse({ ...validInput, ozIn: undefined });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ozIn).toBeUndefined();
    }
  });
});

// ── extractOzFromAlog ─────────────────────────────────────────────────────────

describe('extractOzFromAlog', () => {
  it('returns the input weight as-is when unit is oz', () => {
    expect(extractOzFromAlog([16, 13.5, 'oz'])).toBeCloseTo(16);
  });

  it('returns the input weight as-is for "ounces"', () => {
    expect(extractOzFromAlog([16, 13.5, 'ounces'])).toBeCloseTo(16);
  });

  it('converts grams to oz (divides by 28.3495)', () => {
    const oz = extractOzFromAlog([453.592, 382, 'g']);
    expect(oz).toBeCloseTo(16, 0); // 453.592g ≈ 16 oz
  });

  it('converts "gr" unit to oz', () => {
    const oz = extractOzFromAlog([283.495, 240, 'gr']);
    expect(oz).toBeCloseTo(10, 1);
  });

  it('converts kilograms to oz', () => {
    const oz = extractOzFromAlog([1, 0.85, 'kg']);
    expect(oz).toBeCloseTo(35.274, 1);
  });

  it('converts pounds to oz', () => {
    const oz = extractOzFromAlog([1, 0.85, 'lb']);
    expect(oz).toBeCloseTo(16, 1);
  });

  it('converts "lbs" to oz', () => {
    const oz = extractOzFromAlog([2, 1.7, 'lbs']);
    expect(oz).toBeCloseTo(32, 1);
  });

  it('returns undefined for unknown unit', () => {
    expect(extractOzFromAlog([500, 420, 'stones'])).toBeUndefined();
  });

  it('returns undefined when weight is undefined', () => {
    expect(extractOzFromAlog(undefined)).toBeUndefined();
  });

  it('returns undefined when input weight is 0', () => {
    expect(extractOzFromAlog([0, 0, 'g'])).toBeUndefined();
  });

  it('returns undefined when input weight is negative', () => {
    expect(extractOzFromAlog([-1, 0, 'g'])).toBeUndefined();
  });

  it('returns undefined for malformed weight array (too short)', () => {
    // Cast to bypass TS — tests runtime safety
    expect(extractOzFromAlog([16, 13] as unknown as [number, number, string])).toBeUndefined();
  });

  it('is case-insensitive for unit strings', () => {
    expect(extractOzFromAlog([16, 13.5, 'OZ'])).toBeCloseTo(16);
    expect(extractOzFromAlog([453.592, 382, 'G'])).toBeCloseTo(16, 0);
  });
});

// ── defaultBatchName ──────────────────────────────────────────────────────────

describe('defaultBatchName', () => {
  it('formats as "{coffee_name} {YYYY-MM-DD}"', () => {
    expect(defaultBatchName('Ethiopia Guji Buku', '2026-03-15')).toBe(
      'Ethiopia Guji Buku 2026-03-15'
    );
  });

  it('works with simple coffee names', () => {
    expect(defaultBatchName('Sumatra', '2026-01-01')).toBe('Sumatra 2026-01-01');
  });

  it('preserves spaces in coffee name', () => {
    expect(defaultBatchName('Colombia Huila Honey Process', '2026-06-30')).toBe(
      'Colombia Huila Honey Process 2026-06-30'
    );
  });

  it('works with fallback coffee name format', () => {
    expect(defaultBatchName('Coffee #42', '2026-03-15')).toBe('Coffee #42 2026-03-15');
  });
});
