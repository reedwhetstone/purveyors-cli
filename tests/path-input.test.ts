import { describe, expect, it } from 'vitest';
import { normalizePathInput } from '../src/lib/path-input.js';

describe('normalizePathInput', () => {
  it('trims plain pasted paths', () => {
    expect(normalizePathInput('  /Users/reed/roasts/test.alog  ')).toBe(
      '/Users/reed/roasts/test.alog'
    );
  });

  it('unescapes shell-escaped spaces from pasted macOS paths', () => {
    expect(
      normalizePathInput(
        '/Users/reedwhetstone/Documents/artisan/brazil\\ boa\\ anaerobic_20260430.alog'
      )
    ).toBe('/Users/reedwhetstone/Documents/artisan/brazil boa anaerobic_20260430.alog');
  });

  it('strips matching outer quotes before unescaping path characters', () => {
    expect(normalizePathInput('"/Users/reed/Artisan/Roast\\ #1.alog"')).toBe(
      '/Users/reed/Artisan/Roast #1.alog'
    );
  });

  it('does not strip unmatched quotes', () => {
    expect(normalizePathInput('"/tmp/unfinished')).toBe('"/tmp/unfinished');
  });
});
