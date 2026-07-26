import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});
import type { TastingFilter } from '../src/lib/tasting.js';
import {
  getTastingNotesSchema,
  rateCoffeeSchema,
  isValidCuppingScore,
  parseCuppingScore,
  getTastingNotes,
  rateCoffee,
} from '../src/lib/tasting.js';
import { PrvrsError } from '../src/lib/errors.js';
import { createParchmentClient } from '../src/lib/parchment.js';

// ─── Filter validation (original tests preserved) ─────────────────────────────

const VALID_FILTERS: TastingFilter[] = ['user', 'supplier', 'both'];

function isValidFilter(value: string): value is TastingFilter {
  return VALID_FILTERS.includes(value as TastingFilter);
}

describe('tasting --filter validation', () => {
  it('accepts "user" as a valid filter', () => {
    expect(isValidFilter('user')).toBe(true);
  });

  it('accepts "supplier" as a valid filter', () => {
    expect(isValidFilter('supplier')).toBe(true);
  });

  it('accepts "both" as a valid filter', () => {
    expect(isValidFilter('both')).toBe(true);
  });

  it('rejects unknown filter values', () => {
    expect(isValidFilter('all')).toBe(false);
    expect(isValidFilter('')).toBe(false);
    expect(isValidFilter('USER')).toBe(false);
  });
});

// ─── getTastingNotesSchema ────────────────────────────────────────────────────

describe('getTastingNotesSchema', () => {
  it('accepts a valid bean_id', () => {
    const result = getTastingNotesSchema.parse({ bean_id: 42 });
    expect(result.bean_id).toBe(42);
  });

  it('defaults filter to "both" when omitted', () => {
    const result = getTastingNotesSchema.parse({ bean_id: 1 });
    expect(result.filter).toBe('both');
  });

  it('accepts filter "user"', () => {
    const result = getTastingNotesSchema.parse({ bean_id: 1, filter: 'user' });
    expect(result.filter).toBe('user');
  });

  it('accepts filter "supplier"', () => {
    const result = getTastingNotesSchema.parse({ bean_id: 1, filter: 'supplier' });
    expect(result.filter).toBe('supplier');
  });

  it('accepts filter "both" explicitly', () => {
    const result = getTastingNotesSchema.parse({ bean_id: 1, filter: 'both' });
    expect(result.filter).toBe('both');
  });

  it('rejects bean_id of 0', () => {
    expect(() => getTastingNotesSchema.parse({ bean_id: 0 })).toThrow();
  });

  it('rejects negative bean_id', () => {
    expect(() => getTastingNotesSchema.parse({ bean_id: -1 })).toThrow();
  });

  it('rejects non-integer bean_id', () => {
    expect(() => getTastingNotesSchema.parse({ bean_id: 1.5 })).toThrow();
  });

  it('rejects invalid filter string', () => {
    expect(() => getTastingNotesSchema.parse({ bean_id: 1, filter: 'all' })).toThrow();
    expect(() => getTastingNotesSchema.parse({ bean_id: 1, filter: '' })).toThrow();
  });

  it('rejects missing bean_id', () => {
    expect(() => getTastingNotesSchema.parse({})).toThrow();
  });
});

// ─── rateCoffeeSchema ─────────────────────────────────────────────────────────

describe('rateCoffeeSchema', () => {
  const validInput = { aroma: 4, body: 3, acidity: 5, sweetness: 4, aftertaste: 4 };

  it('accepts all five required scores', () => {
    const result = rateCoffeeSchema.parse(validInput);
    expect(result.aroma).toBe(4);
    expect(result.body).toBe(3);
    expect(result.acidity).toBe(5);
    expect(result.sweetness).toBe(4);
    expect(result.aftertaste).toBe(4);
  });

  it('accepts optional brewMethod and notes', () => {
    const result = rateCoffeeSchema.parse({
      ...validInput,
      brewMethod: 'pour_over',
      notes: 'Bright and fruity',
    });
    expect(result.brewMethod).toBe('pour_over');
    expect(result.notes).toBe('Bright and fruity');
  });

  it('allows brewMethod and notes to be omitted', () => {
    const result = rateCoffeeSchema.parse(validInput);
    expect(result.brewMethod).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  it('rejects score 0', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, aroma: 0 })).toThrow();
  });

  it('rejects score 6', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, body: 6 })).toThrow();
  });

  it('rejects negative scores', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, acidity: -1 })).toThrow();
  });

  it('rejects float scores', () => {
    expect(() => rateCoffeeSchema.parse({ ...validInput, sweetness: 3.5 })).toThrow();
  });

  it('rejects missing required field (aroma)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { aroma: _, ...noAroma } = validInput;
    expect(() => rateCoffeeSchema.parse(noAroma)).toThrow();
  });

  it('accepts boundary scores of 1 and 5', () => {
    const result = rateCoffeeSchema.parse({
      aroma: 1,
      body: 5,
      acidity: 1,
      sweetness: 5,
      aftertaste: 1,
    });
    expect(result.aroma).toBe(1);
    expect(result.body).toBe(5);
  });
});

// ─── isValidCuppingScore ──────────────────────────────────────────────────────

describe('isValidCuppingScore', () => {
  it('accepts integers 1 through 5', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(isValidCuppingScore(n)).toBe(true);
    }
  });

  it('rejects 0', () => {
    expect(isValidCuppingScore(0)).toBe(false);
  });

  it('rejects 6', () => {
    expect(isValidCuppingScore(6)).toBe(false);
  });

  it('rejects negative values', () => {
    expect(isValidCuppingScore(-1)).toBe(false);
  });

  it('rejects floats', () => {
    expect(isValidCuppingScore(3.5)).toBe(false);
    expect(isValidCuppingScore(1.1)).toBe(false);
  });
});

// ─── parseCuppingScore ────────────────────────────────────────────────────────

describe('parseCuppingScore', () => {
  it('parses valid score strings', () => {
    expect(parseCuppingScore('1', 'aroma')).toBe(1);
    expect(parseCuppingScore('3', 'body')).toBe(3);
    expect(parseCuppingScore('5', 'acidity')).toBe(5);
  });

  it('throws PrvrsError for out-of-range values', () => {
    expect(() => parseCuppingScore('0', 'aroma')).toThrow(PrvrsError);
    expect(() => parseCuppingScore('6', 'body')).toThrow(PrvrsError);
    expect(() => parseCuppingScore('-1', 'acidity')).toThrow(PrvrsError);
  });

  it('throws PrvrsError for non-numeric strings', () => {
    expect(() => parseCuppingScore('abc', 'sweetness')).toThrow(PrvrsError);
    expect(() => parseCuppingScore('', 'aftertaste')).toThrow(PrvrsError);
  });

  it('rejects decimals and suffixed integer input', () => {
    expect(() => parseCuppingScore('3.5', 'aroma')).toThrow(PrvrsError);
    expect(() => parseCuppingScore('3notes', 'aroma')).toThrow(PrvrsError);
  });

  it('includes the flag name in the error message', () => {
    try {
      parseCuppingScore('99', 'aroma');
      expect.fail('Expected PrvrsError');
    } catch (e) {
      expect(e).toBeInstanceOf(PrvrsError);
      expect((e as PrvrsError).message).toContain('--aroma');
    }
  });
});

describe('getTastingNotes', () => {
  it('reads the canonical tasting envelope through the SDK', async () => {
    const data = {
      beanId: 128,
      filter: 'both' as const,
      supplier: {
        source: 'supplier' as const,
        catalogId: 128,
        name: 'Ethiopian Guji',
        processing: 'natural',
        region: 'Guji',
        cupping_notes: 'blueberry, jasmine',
        ai_tasting_notes: null,
        ai_description: 'Fruity and floral',
      },
      user: null,
    };
    const get = vi.fn().mockResolvedValue({
      data: { data, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ tasting: { get } } as never);

    await expect(getTastingNotes(128, 'both')).resolves.toEqual(data);
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(get).toHaveBeenCalledWith('128', { filter: 'both' });
  });
});

describe('rateCoffee', () => {
  const validInput = { aroma: 4, body: 3, acidity: 5, sweetness: 4, aftertaste: 4 };

  it('writes the canonical tasting payload with a pinned token', async () => {
    const expected = {
      id: 7,
      rank: null,
      notes: null,
      cupping_notes: JSON.stringify({ ...validInput, brew_method: 'pour_over' }),
      purchase_date: null,
      purchased_qty_lbs: 5,
      bean_cost: 8,
      tax_ship_cost: null,
      last_updated: '2026-07-12T00:00:00.000Z',
      user: 'user-1',
      catalog_id: 128,
      stocked: true,
      coffee_catalog: null,
    };
    const rate = vi.fn().mockResolvedValue({
      data: { data: expected, meta: {} },
      response: new Response(null, { status: 200 }),
    });
    const list = vi.fn().mockResolvedValue({
      data: { data: [expected], meta: {} },
      response: new Response(null, { status: 200 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({
      tasting: { rate },
      inventory: { list },
    } as never);

    await expect(
      rateCoffee(
        7,
        {
          ...validInput,
          brewMethod: 'pour_over',
          notes: 'Clean finish',
        },
        'session-token'
      )
    ).resolves.toEqual(expected);
    expect(createParchmentClient).toHaveBeenCalledWith('member', 'session-token');
    expect(rate).toHaveBeenCalledWith(7, {
      ...validInput,
      brewMethod: 'pour_over',
      notes: 'Clean finish',
    });
    expect(list).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  it('unwraps API ownership failures', async () => {
    const rate = vi.fn().mockResolvedValue({
      error: { error: { message: 'Inventory item not found or not owned by caller' } },
      response: new Response(null, { status: 404 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({ tasting: { rate } } as never);

    await expect(rateCoffee(99, validInput, 'session-token')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Inventory item not found or not owned by caller',
    });
  });
});
