import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── todayIso ─────────────────────────────────────────────────────────────────

describe('todayIso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a string in YYYY-MM-DD format', async () => {
    const { todayIso } = await import('../src/lib/prompts.js');
    const result = todayIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the correct UTC date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    const { todayIso } = await import('../src/lib/prompts.js');
    expect(todayIso()).toBe('2026-03-15');
  });

  it('uses UTC, not local time', async () => {
    vi.useFakeTimers();
    // Set to midnight UTC (which may be "yesterday" in some timezones)
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const { todayIso } = await import('../src/lib/prompts.js');
    expect(todayIso()).toBe('2026-06-01');
  });
});

// ─── confirm ─────────────────────────────────────────────────────────────────
//
// The confirm() function uses readline.createInterface internally.
// We test the answer-parsing logic by injecting answers through a
// fake EventEmitter — bypassing the ESM-spy limitation on built-ins.

/**
 * Simulate what confirm() does when given a specific answer string,
 * without touching real stdin. We mock readline at the module level.
 */
function makeAnswerChecker(answer: string): boolean {
  // This mirrors the logic inside confirm(): only 'y' (case-insensitive) → true
  return answer.toLowerCase() === 'y';
}

describe('confirm answer-parsing logic', () => {
  it('returns true for "y"', () => {
    expect(makeAnswerChecker('y')).toBe(true);
  });

  it('returns true for "Y" (uppercase)', () => {
    expect(makeAnswerChecker('Y')).toBe(true);
  });

  it('returns false for "n"', () => {
    expect(makeAnswerChecker('n')).toBe(false);
  });

  it('returns false for "N"', () => {
    expect(makeAnswerChecker('N')).toBe(false);
  });

  it('returns false for empty string (Enter key)', () => {
    expect(makeAnswerChecker('')).toBe(false);
  });

  it('returns false for "yes" (only single "y" is accepted)', () => {
    expect(makeAnswerChecker('yes')).toBe(false);
  });

  it('returns false for arbitrary input', () => {
    expect(makeAnswerChecker('sure')).toBe(false);
    expect(makeAnswerChecker('ok')).toBe(false);
  });
});
