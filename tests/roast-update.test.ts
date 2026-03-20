import { describe, it, expect } from 'vitest';
import { updateRoastSchema } from '../src/lib/roast.js';

describe('updateRoastSchema', () => {
  it('accepts notes only', () => {
    const result = updateRoastSchema.safeParse({ notes: 'Great roast' });
    expect(result.success).toBe(true);
  });

  it('accepts ozOut only', () => {
    const result = updateRoastSchema.safeParse({ ozOut: 12.5 });
    expect(result.success).toBe(true);
  });

  it('accepts batchName only', () => {
    const result = updateRoastSchema.safeParse({ batchName: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('accepts all fields together', () => {
    const result = updateRoastSchema.safeParse({
      notes: 'Updated notes',
      ozOut: 10.2,
      batchName: 'Updated Batch',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (no fields)', () => {
    const result = updateRoastSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects all-undefined fields', () => {
    const result = updateRoastSchema.safeParse({
      notes: undefined,
      ozOut: undefined,
      batchName: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive ozOut', () => {
    const result = updateRoastSchema.safeParse({ ozOut: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative ozOut', () => {
    const result = updateRoastSchema.safeParse({ ozOut: -5 });
    expect(result.success).toBe(false);
  });
});
