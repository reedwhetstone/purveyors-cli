import { describe, expect, it } from 'vitest';
import { parseStrictFiniteNumber } from '../src/lib/strict-number.js';

describe('parseStrictFiniteNumber', () => {
  it.each(['12.5abc', '10kg', 'Infinity', '', '   '])(
    'rejects non-numeric or suffixed input %j',
    (value) => {
      expect(Number.isFinite(parseStrictFiniteNumber(value))).toBe(false);
    }
  );

  it.each([
    ['12.5', 12.5],
    [' 10 ', 10],
    ['1e2', 100],
  ])('accepts the complete numeric value %j', (value, expected) => {
    expect(parseStrictFiniteNumber(value)).toBe(expected);
  });
});
