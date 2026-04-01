# PR Verification Report

## Metadata

- Repo: reedwhetstone/purveyors-cli
- Base: origin/main (812ad34)
- Head: b14e40f (test/inventory-sales-query-builder-tests)
- PR: #67
- Reviewer model: anthropic/claude-opus-4-6
- Confidence: High
- Scope note: 3 files changed (676 insertions), test-only PR plus a docs addition from a stacked branch

## Executive Verdict

- Merge readiness: **Ready with fixes** (minor)
- Intent coverage: **Full**
- Priority summary: P0: 0, P1: 1, P2: 3, P3: 2

## Intent Verification

- **Stated intent:** Add query-builder level tests for `listInventory()` and `listSales()` to verify server-side filters reach the Supabase query chain. These functions acquired filters in PRs #63 and #64 but only received schema-level (Zod) tests. Close the gap using the same mock-Supabase pattern from `roast-list.test.ts`.
- **What was implemented:**
  - `tests/inventory.test.ts`: 22 new query-builder tests covering user filter, stocked_only (true/false/omitted), catalogId, purchaseDateStart/End, origin (two-step catalog lookup + .in()), default/custom limit, order, return values, empty results.
  - `tests/sales.test.ts`: 14 new query-builder tests covering user filter, roastId, dateStart/End, buyer (ilike), all-filters-combined, default/custom limit, order, return values, empty results.
  - `docs/CLI_STRATEGY.md`: Strategy doc ported from brain (separate commit from stacked branch `docs/brain-port-cli-strategy`).
- **Coverage gaps:** See P1 and P2 findings below.

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

- **Title:** Stacked commit from unmerged branch included in PR diff
- **Evidence:** `git log origin/main..HEAD` shows two commits: `dfaae19` (docs: port CLI strategy doc from brain to codebase) and `b14e40f` (test: add query-builder tests). Commit `dfaae19` lives on `origin/docs/brain-port-cli-strategy`, a separate unmerged branch. The test branch was created on top of that unmerged branch rather than off `origin/main`.
- **Impact:** PR #67 will include the entire `docs/CLI_STRATEGY.md` file (263 lines) as part of its diff, muddying the PR scope. If the docs branch is merged first, GitHub will auto-rebase, but if it isn't, this PR carries the docs commit too. Reviewers see a "test-only" PR with a 263-line strategy doc.
- **Correction:** Rebase the test commit onto `origin/main`:
  ```bash
  git rebase --onto origin/main docs/brain-port-cli-strategy test/inventory-sales-query-builder-tests
  git push --force-with-lease origin test/inventory-sales-query-builder-tests
  ```
  Alternatively, merge the docs PR (#66?) first, then this PR's diff will naturally exclude it.

### P2 (important improvements)

- **Title:** `sanitizeFilterValue` not tested through the mock for `listInventory` origin and `listSales` buyer paths
- **Evidence:** `src/lib/inventory.ts:149` calls `sanitizeFilterValue(parsed.origin)` before the ilike. `src/lib/sales.ts:95` calls `sanitizeFilterValue(parsed.buyer)` before the ilike. The inventory test at "applies origin filter" passes `'Ethiopia'` (no special chars), and the sales test passes `'Alice'` and `'Bob'` (no special chars). Neither test verifies that special characters like `(`, `)`, `%`, `*` are stripped before reaching the query.
- **Impact:** Low risk since `sanitizeFilterValue` has its own unit tests in `lib.test.ts` and `catalog.test.ts`, but the query-builder tests don't verify the integration; a future refactor could remove the sanitize call without any query-builder test failing.
- **Correction:** Add one test per file with special chars to prove sanitization reaches the query:
  - `inventory.test.ts`: `await listInventory(supabase, 'u', { origin: 'Eth(iopia)' })` then assert ilike args are `['country', '%Ethiopia%']`
  - `sales.test.ts`: `await listSales(supabase, 'u', { buyer: 'Ali%ce' })` then assert ilike args are `['buyer', '%Alice%']`

- **Title:** Inventory mock does not verify the `select` column string
- **Evidence:** `createSupabaseForInventoryList` has `select(_columns: string)` that ignores the argument. The real `listInventory` calls `.select(INVENTORY_LIST_SELECT)` which includes a complex join (`coffee_catalog!catalog_id (...)`). The mock doesn't capture or assert on the select value. Same pattern for sales mock (less critical since sales select is simpler).
- **Impact:** If someone changes the select columns (e.g., drops the catalog join), no query-builder test would catch it. This is acceptable for a first pass since the mock pattern from `roast-list.test.ts` also ignores it, but it's a blind spot across all three test files.
- **Correction:** Capture the select string in a variable and add one assertion per test suite: `expect(selectArg).toBe(INVENTORY_LIST_SELECT)`. Import `INVENTORY_LIST_SELECT` from the source module.

- **Title:** No test for error propagation from Supabase
- **Evidence:** Both `listInventory` and `listSales` have `if (error) throw error` after the query resolves. Neither test suite includes a case where the mock returns `{ data: null, error: someError }`. The `roast-list.test.ts` reference pattern also omits this, so it's a shared gap.
- **Impact:** Low, but the error path is untested at the query-builder level. A future change to error handling (e.g., wrapping in PrvrsError) could silently change behavior.
- **Correction:** Add one test per suite: mock `limit()` resolving to `{ data: null, error: { message: 'timeout' } }`, assert the function throws.

### P3 (nice to have)

- **Title:** `QueryCall` type and mock helpers are duplicated across three test files
- **Evidence:** `QueryCall` type is identically defined in `roast-list.test.ts:201`, `inventory.test.ts:309`, and `sales.test.ts:245`. The `createRoastProfilesQuery`, `createInventoryQuery`, and `createSalesQuery` functions are structurally identical; only the factory name and the table name in the outer mock differ.
- **Impact:** Maintenance burden. Adding a new Supabase method to the mock (e.g., `.contains()`, `.neq()`) requires updating all three files.
- **Correction:** Extract to a shared `tests/helpers/mock-supabase.ts` with a generic `createMockQuery(result)` function and `QueryCall` type export. The inventory-specific two-table mock can extend the base. Not required for this PR but worth a follow-up.

- **Title:** Dead code in inventory mock (`catalogQuery`, `catalogSelectResult`)
- **Evidence:** In `createSupabaseForInventoryList`, there's an unused `catalogQuery` object (lines ~370-380 in the diff) and a `catalogSelectResult` variable, both silenced with `void` statements at the bottom. These appear to be remnants of an earlier draft where the catalog mock was separate from `catalogQueryWithResolve`.
- **Impact:** Cosmetic; no runtime effect. Slightly confusing for readers.
- **Correction:** Remove `catalogQuery`, `catalogSelectResult`, and their `void` silencers. Only `catalogQueryWithResolve` is used.

## Assumptions Review

| Assumption                                                                                                       | Validity  | Why                                                                                                                                                                                         | Action                                |
| ---------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Mock's chainable `.eq().gte().lte().in().order().limit()` accurately reflects Supabase PostgREST client behavior | **Valid** | Supabase JS client v2 uses exactly this chainable pattern; `limit()` is indeed terminal (returns the promise). Same assumption as `roast-list.test.ts` which is already merged and passing. | None                                  |
| `limit()` is always the last call in the chain                                                                   | **Valid** | Source code for both `listInventory` and `listSales` calls `.order().limit()` as the final two methods. The mock correctly makes `limit()` the promise-returning terminal.                  | None                                  |
| Origin filter two-step lookup (catalog ilike → inventory .in) is correctly modeled                               | **Valid** | `src/lib/inventory.ts:147-158` shows exactly this pattern: catalog query with ilike on 'country', extract IDs, short-circuit on empty, then .in() on inventory query. Mock matches.         | None                                  |
| `listSales` select includes a roast_profiles join                                                                | **Weak**  | Source shows `select(\`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)\`)` but the mock ignores the select argument entirely. Test doesn't verify the join is present.    | See P2 finding on select verification |

## Tech Debt Notes

- **Debt introduced:** Triplicated `QueryCall` type and mock query builder across three test files. Minor, but will compound if more list functions (e.g., `listTastingNotes`) get similar tests.
- **Debt worsened:** None.
- **Suggested follow-up tickets:**
  1. Extract shared mock-Supabase helpers to `tests/helpers/mock-supabase.ts`
  2. Add error-path tests for all list functions (shared gap across inventory, sales, roasts)
  3. Add select-column assertions to verify join shapes aren't silently changed

## Product Alignment Notes

- **Alignment wins:** Tests directly validate that server-side filters from PRs #63 and #64 actually reach the Supabase query chain. This closes a real testing gap; previously only Zod parsing was tested, meaning a filter could parse correctly but never be wired to the query.
- **Misalignments:** None. This is pure test infrastructure with no product-facing changes.

## Test Coverage Assessment

- **Existing tests that validate changes:** All 118 tests pass (52 sales, 66 inventory). Schema tests pre-existed; query-builder tests are new.
- **Missing tests:**
  1. `sanitizeFilterValue` integration through inventory origin and sales buyer filters with special-char inputs
  2. Error propagation when Supabase query returns an error
  3. Select column verification (join shape)
- **Suggested test additions:** See P2 corrections above.

## Minimal Correction Plan

1. **Rebase off origin/main** to drop the stacked docs commit (P1). This keeps PR #67 scoped to test-only changes as described.
2. **Remove dead code** (`catalogQuery`, `catalogSelectResult`, void silencers) from `tests/inventory.test.ts` (P3).
3. (Optional but recommended) Add one sanitize-integration test each for inventory origin and sales buyer (P2).

## Optional Patch Guidance

### `tests/inventory.test.ts`

Remove the unused mock objects around lines 370-390 of the file (the `catalogQuery` block, `catalogSelectResult`, and their `void` statements). Only `catalogQueryWithResolve` is used by the `supabase.from('coffee_catalog')` branch.

Add after the "applies origin filter" test:

```typescript
it('sanitizes special chars in origin before ilike', async () => {
  const { supabase, catalogCalls } = createSupabaseForInventoryList({
    catalogIdsForOrigin: [1],
  });
  await listInventory(supabase, 'u', { origin: 'Eth(iopia)' });
  expect(catalogCalls).toContainEqual({
    method: 'ilike',
    args: ['country', '%Ethiopia%'],
  });
});
```

### `tests/sales.test.ts`

Add after the "applies buyer as ilike filter" test:

```typescript
it('sanitizes special chars in buyer before ilike', async () => {
  const { supabase, salesQuery } = createSupabaseForSalesList([]);
  await listSales(supabase, 'u', { buyer: 'Ali%ce' });
  expect(salesQuery.calls).toContainEqual({
    method: 'ilike',
    args: ['buyer', '%Alice%'],
  });
});
```

### Branch rebase

```bash
git rebase --onto origin/main dfaae19 test/inventory-sales-query-builder-tests
git push --force-with-lease origin test/inventory-sales-query-builder-tests
```
