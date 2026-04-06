# Plan: Unit Tests for `findSimilarBeansSchema` and `findSimilarBeans`

**Date:** 2026-04-03
**Slug:** find-similar-beans-tests
**Priority:** Medium
**Risk:** Low

---

## Problem Description

`findSimilarBeans` and `findSimilarBeansSchema` in `src/lib/catalog.ts` have zero unit-test coverage.

Evidence:

- `grep -rn "findSimilar" tests/` returns no results
- `catalog similar` is the only catalog subcommand with no schema tests
- `tests/catalog.test.ts` covers `computeCatalogStats`, `searchCatalogSchema`, and `sanitizeFilterValue` — but not the similarity path
- The function is consumed by both the CLI (`src/commands/catalog.ts`) **and** coffee-app's `tools.ts` as `find_similar_beans` tool (line 335), making it a high-stakes, cross-surface function
- The schema has non-obvious behavior: `threshold` and `limit` are both `.optional()` AND have `.default()` — a Zod pattern that creates subtle parse differences between `z.input<>` and `z.output<>` types

---

## Root Cause

The `findSimilarBeans` function was added as a pure lib function with a Zod schema in the same style as `searchCatalogSchema`, `listInventorySchema`, etc. — but the test file focused only on query-building utilities. The similarity RPC call takes `threshold` and `limit` with defaults, and the command layer parses those defaults from CLI strings before passing to the lib. This interaction is untested.

---

## Proposed Fix

Add a new `describe('findSimilarBeansSchema', ...)` block to `tests/catalog.test.ts` and a `describe('findSimilarBeans', ...)` block that mocks `supabase.rpc`.

### Files to Change

- `tests/catalog.test.ts` — add tests at the end of the file

### Test Cases to Cover

**Schema validation (`findSimilarBeansSchema`):**

1. `coffee_id` is required — parse throws if omitted
2. `coffee_id` must be a positive integer — rejects 0, negative, float
3. `threshold` defaults to 0.7 when omitted
4. `threshold` accepts 0 (inclusive lower bound)
5. `threshold` accepts 1 (inclusive upper bound)
6. `threshold` rejects values > 1
7. `threshold` rejects values < 0
8. `limit` defaults to 10 when omitted
9. `limit` accepts 1 (minimum)
10. `limit` accepts 50 (maximum)
11. `limit` rejects 0
12. `limit` rejects 51 (exceeds max)
13. `limit` rejects non-integer floats
14. All optional fields can be omitted — only `coffee_id` required

**Lib function (`findSimilarBeans`):**

15. Returns `SimilarBean[]` on successful RPC call (mock supabase.rpc resolves with fixture data)
16. Returns empty array when RPC returns null/empty
17. Throws `Error` with `RPC error: <message>` when RPC returns an error object
18. Passes `target_coffee_id`, `match_threshold`, and `match_count` correctly to RPC
19. Uses schema defaults (0.7 threshold, 10 limit) when not provided
20. Uses provided threshold and limit when specified

### Mock Pattern

Follow the same pattern used in `tests/inventory-delete.test.ts` — a `makeSupabase()` factory that returns a mock with `.rpc()` method:

```typescript
function makeSupabaseRpc(response: { data?: unknown; error?: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(response),
  } as unknown as SupabaseClient;
}
```

---

## Acceptance Criteria

- [ ] All tests in `tests/catalog.test.ts` continue to pass (non-breaking addition)
- [ ] New test block covers all 20 cases listed above
- [ ] Tests use `vi.fn()` mocks — no real network calls
- [ ] `npx vitest run` passes with 0 failures
- [ ] Test count increases by ~20 (from 35 → ~55 in catalog.test.ts)

---

## Test Plan

```bash
cd repos/purveyors-cli
npx vitest run tests/catalog.test.ts
```

Verify new describe blocks appear and all pass.

---

## Risk Assessment

**Risk: Low**

- Tests only — no production code changes
- No new dependencies
- Follows established patterns in the test suite
- Cannot break existing behavior

---

## Why This Over Alternatives Considered

**Alternatives evaluated:**

1. **`catalog similar` --stocked-only client-side filter → server-side** — High impact (RPC already returns stocked field, so filtering via the RPC `match_count` limit means stocked-only may return far fewer results than requested). But requires RPC-level change or post-fetch padding logic. Medium complexity, medium risk.

2. **`process.exit(1)` → `throw PrvrsError` in catalog.ts validation paths** — There are 4 `process.exit(1)` calls in `src/commands/catalog.ts` that bypass `withErrorHandling`. This is an inconsistency but low-impact for real users; fixing it requires touching command code. Medium complexity, low-to-medium risk.

3. **`findSimilarBeansSchema` + `findSimilarBeans` unit tests** (selected) — The similarity path is used in coffee-app's AI agent tools and is entirely untested. The schema has a Zod optional+default interaction that's easy to get wrong. Zero risk (tests only), directly improves CI confidence on a cross-surface function. Small, shippable.

The test coverage gap on a function with direct AI-tool-call exposure is the clearest win today: low effort, high confidence gain, zero risk.

---

## Open Questions

- None — `supabase.rpc` mock pattern is well-established in the existing test suite.
