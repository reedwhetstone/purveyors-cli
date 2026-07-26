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
