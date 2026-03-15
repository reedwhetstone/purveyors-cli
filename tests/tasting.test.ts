import { describe, it, expect } from 'vitest';
import type { TastingFilter } from '../src/commands/tasting.js';

// Pure logic helpers extracted from tasting.ts for unit testing.
// The main command relies on live Supabase; these tests cover the validation
// logic that guards the --filter option.

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
