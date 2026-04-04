# PR Verification Report

## Metadata

- **Repo:** purveyors-cli
- **Base:** origin/main (1ec3994)
- **Head:** 4d8f2c3 (feat/tasting-schema-and-query-builder-tests)
- **PR #:** 71
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Single file change (tests/tasting.test.ts), test-only PR. 438 insertions, 4 deletions. No production code changes.

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 2, P2: 3, P3: 2

## Intent Verification

- **Stated intent:** Expand tasting test coverage from 4 filter-validation tests to cover all exported schemas (getTastingNotesSchema, rateCoffeeSchema), validation helpers (isValidCuppingScore, parseCuppingScore), and async lib functions (getTastingNotes, rateCoffee) with query-builder mocks.
- **What was implemented:** 44 total tests (4 original + 40 new) across 7 describe blocks covering all stated targets. Supabase query-builder mocks built for both getTastingNotes and rateCoffee.
- **Coverage gaps:** See P1/P2 findings below. The stated intent is fully covered; gaps are in edge cases that a thorough test suite should include.

## Checklist Audit

### 1) Intent Coverage — PASS

All six export targets named in the intent are tested: getTastingNotesSchema, rateCoffeeSchema, isValidCuppingScore, parseCuppingScore, getTastingNotes, rateCoffee. The original 4 filter-validation tests are preserved unchanged.

### 2) Correctness — PASS with CONCERNS

- Tests pass (verified: 44/44 green, 20ms runtime).
- Schema tests exercise happy paths and key boundary conditions.
- Query-builder mock patterns match established repo conventions (cf. inventory-delete.test.ts).
- See P1-1 and P1-2 for mock fidelity concerns.

### 3) Codebase Alignment — PASS

- Mock factory naming follows repo convention: `makeTastingSupabase`, `makeRatingSupabase` (cf. `makeSupabase` in inventory-delete.test.ts).
- Section headers using `// ─── Title ───` match existing file style.
- Import structure consistent with other test files.
- `as never` casting for Supabase mocks is consistent with inventory-delete patterns.

### 4) Risk and Regressions — PASS

- Test-only change; zero production code modifications.
- No backward compatibility risk.
- No deployment sequencing concerns.

### 5) Security and Data Safety — N/A

Test-only; no auth/data handling changes.

### 6) Test and Verification Quality — PASS with CONCERNS

See detailed findings below.

### 7) Tech Debt and Maintainability — CONCERN

Two separate mock factories with similar but not identical patterns. Not blocking, but see P3-1.

### 8) Product and UX Alignment — N/A

Test-only change.

### 9) Assumptions Audit — See section below.

### 10) Final Verdict — Ready with fixes (P1s should be addressed)

---

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

#### P1-1: `getTastingNotes` with filter "both" lacks a combined happy-path test

**Evidence:** `tests/tasting.test.ts` — the `getTastingNotes` describe block tests `filter: "supplier"` (happy path + PGRST116), `filter: "user"` (happy path + empty), and `filter: "both"` only for the empty/not-found case (lines 326-335). There is no test where `filter: "both"` returns _both_ supplier and user data populated.

**Impact:** The `filter: "both"` code path in `src/lib/tasting.ts` (lines 112-158) executes both the catalog query and the inventory query sequentially. A test with both populated would verify:

1. Both branches execute and populate result fields.
2. The mock's `currentTable` state-tracking correctly switches between `coffee_catalog` and `green_coffee_inv` across two sequential `from()` calls.

Without this test, a regression that breaks the second query when both run would go undetected.

**Correction:** Add a test case in the `getTastingNotes` describe block:

```typescript
it('fetches both supplier and user notes when filter is "both"', async () => {
  const catalogData = {
    id: 128,
    name: 'Test',
    processing: null,
    region: null,
    source: 'Test',
    cupping_notes: 'citrus',
    ai_tasting_notes: null,
    ai_description: null,
  };
  const invRow = { id: 7, catalog_id: 128, cupping_notes: { aroma: 4 }, notes: 'Good' };
  const supabase = makeTastingSupabase({
    coffee_catalog: { data: catalogData, error: null },
    green_coffee_inv: { data: [invRow], error: null },
  });
  const result = await getTastingNotes(supabase as never, 'user-abc', 128, 'both');
  expect(result.supplier).not.toBeNull();
  expect(result.user).not.toBeNull();
  expect(result.beanId).toBe(128);
  expect(result.filter).toBe('both');
});
```

#### P1-2: No test for non-PGRST116 catalog errors (throw path)

**Evidence:** `src/lib/tasting.ts` line 122-123: `if (catalogError && catalogError.code !== 'PGRST116') { throw catalogError; }`. The test at line 286 covers the PGRST116 (not found) case only. The throw-on-unexpected-error path has zero coverage.

**Impact:** This is the error-propagation path for unexpected database failures (connection errors, permission errors, etc.). If someone refactors error handling and accidentally swallows non-PGRST116 errors, no test would catch it.

**Correction:** Add a test:

```typescript
it('throws when catalog query fails with a non-PGRST116 error', async () => {
  const supabase = makeTastingSupabase({
    coffee_catalog: { data: null, error: { code: '42501', message: 'permission denied' } },
  });
  await expect(
    getTastingNotes(supabase as never, 'user-abc', 128, 'supplier')
  ).rejects.toMatchObject({ code: '42501' });
});
```

### P2 (important improvements)

#### P2-1: No test for inventory query error path in getTastingNotes

**Evidence:** `src/lib/tasting.ts` line 150: `if (invError) throw invError;`. No test exercises this path.

**Impact:** Similar to P1-2 but for the inventory table. The error throw is unconditional (no code-filtering like the catalog path), so it's simpler, but still represents an untested error propagation path.

**Correction:** Add:

```typescript
it('throws when inventory query fails', async () => {
  const supabase = makeTastingSupabase({
    green_coffee_inv: { data: null, error: { message: 'connection timeout' } },
  });
  await expect(getTastingNotes(supabase as never, 'user-abc', 128, 'user')).rejects.toMatchObject({
    message: 'connection timeout',
  });
});
```

#### P2-2: rateCoffee re-fetch error path untested

**Evidence:** `src/lib/tasting.ts` line 217: `if (error) throw error;` (the re-fetch after update). No test covers the case where the update succeeds but the subsequent re-fetch fails.

**Impact:** Edge case, but represents a real failure mode (row deleted between update and re-fetch, or transient error). The mock's `callCount` mechanism supports this; just needs a test case with `refetch: { data: null, error: { message: 'Row vanished' } }`.

**Correction:**

```typescript
it('throws when re-fetch after update fails', async () => {
  const supabase = makeRatingSupabase({
    fetchExisting: { data: { id: 7, catalog_id: 128 }, error: null },
    refetch: { data: null, error: new Error('re-fetch failed') },
  });
  await expect(rateCoffee(supabase as never, 'user-abc', 7, validInput)).rejects.toThrow(
    're-fetch failed'
  );
});
```

#### P2-3: `cuppingScoreSchema` and `tastingFilterSchema` not directly tested

**Evidence:** The file imports and tests `getTastingNotesSchema` and `rateCoffeeSchema` (which use these sub-schemas internally), but the exported `cuppingScoreSchema` and `tastingFilterSchema` are not directly tested as standalone exports.

**Impact:** Low, since they're exercised indirectly. But they're public exports; a direct test would catch if someone accidentally changes their constraints without updating the parent schemas.

**Correction:** Optional. Could add a small describe block for each, or accept the indirect coverage.

### P3 (nice to have)

#### P3-1: Mock factories could be extracted to a shared helper

**Evidence:** `makeTastingSupabase` and `makeRatingSupabase` both implement Supabase chain mocking with similar patterns. `inventory-delete.test.ts` has its own `makeSupabase`. Three files now have independent mock factories.

**Impact:** Not a problem today, but as more query-builder tests are added (the stated goal was to close the gap on all async lib functions), maintaining N separate mock factories becomes a maintenance burden.

**Correction:** Consider extracting a shared `tests/fixtures/supabase-mock.ts` helper in a follow-up PR. Not blocking for this PR.

#### P3-2: `parseCuppingScore` float truncation test documents surprising behavior

**Evidence:** Line 210-212: `it('accepts float strings by truncating (parseInt behavior)')` documents that `parseCuppingScore('3.5', 'aroma')` returns 3. This is technically correct (parseInt behavior), but the source function uses `isValidCuppingScore` which checks `Number.isInteger(value)` and parseInt always returns an integer, so the truncation is inherent.

**Impact:** The test is correct and documents behavior accurately. Worth noting that this means "3.5" silently becomes 3 at the CLI level, which could surprise users. Not a test issue; a product consideration for a future PR.

---

## Assumptions Review

| Assumption                                                                           | Validity              | Why                                                                                                                                                                                                                                                                             | Action                                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mock's `then()` method simulates Supabase's promise-like chain for list queries      | **Weak**              | Real Supabase returns a PromiseLike with `.then()` on the builder chain, but the mock's `then` only resolves; it doesn't handle rejection callbacks. If source code ever uses `.catch()` directly on the chain (rather than destructuring `{ error }`), the mock would diverge. | Acceptable for now; Supabase JS client convention is `{ data, error }` not exceptions.                        |
| `makeRatingSupabase` uses call-count to distinguish ownership check from re-fetch    | **Valid but fragile** | Works because `rateCoffee` always calls `.single()` exactly twice in fixed order: once for ownership, once for re-fetch. If someone adds a third `.single()` call or reorders, the mock breaks silently.                                                                        | Document the coupling in the mock's JSDoc. The existing JSDoc comments on `callCount` partially address this. |
| Mock `from()` returns the same chain object for all tables                           | **Valid**             | Matches how the source uses `supabase.from(table).select()...` in sequence. The `currentTable` variable correctly disambiguates.                                                                                                                                                | No action needed.                                                                                             |
| `rateCoffee` always throws `AuthError` when fetchError is truthy OR existing is null | **Valid**             | Source code line 186: `if (fetchError                                                                                                                                                                                                                                           |                                                                                                               | !existing)`. The test at line 390 provides `{ data: null, error: { message: 'not found' } }`, which triggers both conditions simultaneously. A test with `{ data: null, error: null }` (row just doesn't exist) would also be valuable. | Minor gap; the `!existing` branch alone is untested. |

## Tech Debt Notes

- **Debt introduced:** Two new mock factories specific to tasting operations. Minor; follows existing patterns.
- **Debt worsened:** The pattern of per-file mock factories (now in 3 files) increases future maintenance cost slightly.
- **Suggested follow-up tickets:**
  1. Extract shared Supabase mock factory to `tests/fixtures/supabase-mock.ts` (consolidation across inventory-delete, tasting, and future query-builder test files).
  2. Consider testing `cuppingScoreSchema` and `tastingFilterSchema` directly as public API surface.

## Product Alignment Notes

- **Alignment wins:** Tests validate the exact schema constraints users encounter (score 1-5, filter enum, positive int bean_id). Good coverage of the CLI-facing `parseCuppingScore` error messages.
- **Misalignments:** None. Test-only PR with no product behavior changes.
- **Suggested product checks:** The `parseCuppingScore('3.5')` truncation to 3 (P3-2) is worth a product decision: should the CLI reject non-integer string input, or silently truncate? Current behavior silently truncates.

## Test Coverage Assessment

- **Existing tests that validate changes:** All 44 tests pass. Original 4 preserved.
- **Exports tested directly:** getTastingNotesSchema (10 tests), rateCoffeeSchema (9 tests), isValidCuppingScore (5 tests), parseCuppingScore (5 tests), getTastingNotes (5 tests), rateCoffee (6 tests), filter validation (4 original, local helper).
- **Exports NOT tested directly:** cuppingScoreSchema, tastingFilterSchema (tested indirectly via parent schemas).
- **Missing tests:**
  1. getTastingNotes with filter "both" returning both populated (P1-1)
  2. getTastingNotes non-PGRST116 catalog error (P1-2)
  3. getTastingNotes inventory error path (P2-1)
  4. rateCoffee re-fetch error path (P2-2)
  5. rateCoffee with `{ data: null, error: null }` for ownership check (only `!existing` triggers AuthError)

## Minimal Correction Plan

1. **Add combined "both" filter happy-path test** for getTastingNotes (P1-1). ~10 lines.
2. **Add non-PGRST116 error test** for getTastingNotes catalog query (P1-2). ~6 lines.
3. Optionally add P2-1, P2-2, P2-3 in the same commit for completeness.

## Optional Patch Guidance

**File: `tests/tasting.test.ts`**

Insert after the existing "sets beanId and filter" test (around line 335):

```typescript
it('fetches both supplier and user notes when filter is "both"', async () => {
  const catalogData = {
    id: 128,
    name: 'Test Bean',
    processing: 'washed',
    region: 'Huila',
    source: 'Test Source',
    cupping_notes: 'citrus, honey',
    ai_tasting_notes: null,
    ai_description: null,
  };
  const invRow = {
    id: 7,
    catalog_id: 128,
    cupping_notes: { aroma: 4, body: 3, acidity: 5, sweetness: 4, aftertaste: 4 },
    notes: 'Excellent',
  };
  const supabase = makeTastingSupabase({
    coffee_catalog: { data: catalogData, error: null },
    green_coffee_inv: { data: [invRow], error: null },
  });
  const result = await getTastingNotes(supabase as never, 'user-abc', 128, 'both');
  expect(result.supplier).not.toBeNull();
  expect(result.supplier?.name).toBe('Test Bean');
  expect(result.user).not.toBeNull();
  expect(result.user?.inventoryId).toBe(7);
});

it('throws when catalog query returns non-PGRST116 error', async () => {
  const supabase = makeTastingSupabase({
    coffee_catalog: { data: null, error: { code: '42501', message: 'permission denied' } },
  });
  await expect(
    getTastingNotes(supabase as never, 'user-abc', 128, 'supplier')
  ).rejects.toMatchObject({ code: '42501' });
});
```
