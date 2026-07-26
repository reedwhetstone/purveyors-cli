/**
 * Parse a user-supplied decimal number without accepting trailing garbage.
 *
 * `parseFloat` accepts values such as `12.5abc`; this parser requires the
 * entire trimmed value to be a finite decimal number.
 */
export function parseStrictFiniteNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export const POSTGRES_INT4_MAX = 2_147_483_647;

/**
 * Parse a user-supplied base-10 integer without accepting decimals, exponents,
 * or trailing garbage. Bounds are inclusive.
 */
export function parseStrictInteger(
  value: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER
): number {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return Number.NaN;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : Number.NaN;
}

/** Parse a positive PostgreSQL int4 identifier. */
export function parseStrictInt4Id(value: string): number {
  return parseStrictInteger(value, 1, POSTGRES_INT4_MAX);
}

/** Parse a non-negative pagination offset. */
export function parseStrictOffset(value: string): number {
  return parseStrictInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

/** Parse a positive integer count, optionally capped by its command contract. */
export function parseStrictPositiveCount(value: string, max = Number.MAX_SAFE_INTEGER): number {
  return parseStrictInteger(value, 1, max);
}
