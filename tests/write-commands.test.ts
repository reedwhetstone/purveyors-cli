import { describe, it, expect } from 'vitest';
import { isValidCuppingScore, parseCuppingScore } from '../src/commands/tasting.js';
import { PrvrsError } from '../src/lib/errors.js';

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
