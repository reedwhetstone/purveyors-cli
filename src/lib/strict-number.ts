/**
 * Parse a user-supplied number without accepting trailing garbage.
 *
 * `parseFloat` accepts values such as `12.5abc`; Number() gives the CLI the
 * strict whole-value behavior we want, while the explicit blank check avoids
 * Number('') becoming zero.
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
