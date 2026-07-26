import { describe, expect, it } from 'vitest';
import {
  POSTGRES_INT4_MAX,
  parseStrictFiniteNumber,
  parseStrictInt4Id,
  parseStrictInteger,
  parseStrictOffset,
  parseStrictPositiveCount,
} from '../src/lib/strict-number.js';

describe('parseStrictFiniteNumber', () => {
  it.each(['12.5abc', '10kg', 'Infinity', '0x10', '0b10', '0o10', '', '   '])(
    'rejects non-decimal or suffixed input %j',
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

describe('strict integer parsers', () => {
  it.each(['7oops', '3.5', '1e2', '0x10', '', '   ', 'Infinity'])(
    'rejects malformed integer input %j',
    (value) => {
      expect(Number.isFinite(parseStrictInteger(value))).toBe(false);
    }
  );

  it('accepts complete trimmed integer input', () => {
    expect(parseStrictInteger(' 42 ')).toBe(42);
    expect(parseStrictOffset('0')).toBe(0);
    expect(parseStrictPositiveCount('1')).toBe(1);
  });

  it('enforces PostgreSQL int4 identifier boundaries', () => {
    expect(parseStrictInt4Id('1')).toBe(1);
    expect(parseStrictInt4Id(String(POSTGRES_INT4_MAX))).toBe(POSTGRES_INT4_MAX);
    expect(Number.isFinite(parseStrictInt4Id('0'))).toBe(false);
    expect(Number.isFinite(parseStrictInt4Id(String(POSTGRES_INT4_MAX + 1)))).toBe(false);
  });

  it('enforces offset and count boundaries', () => {
    expect(Number.isFinite(parseStrictOffset('-1'))).toBe(false);
    expect(Number.isFinite(parseStrictPositiveCount('0'))).toBe(false);
    expect(parseStrictPositiveCount('25', 25)).toBe(25);
    expect(Number.isFinite(parseStrictPositiveCount('26', 25))).toBe(false);
  });

  it.each([100, 1000])('enforces an endpoint count maximum of %i', (max) => {
    expect(parseStrictPositiveCount(String(max), max)).toBe(max);
    expect(Number.isFinite(parseStrictPositiveCount(String(max + 1), max))).toBe(false);
  });
});
