# PR Verification Report

## Metadata

- **Repo:** purveyors-cli
- **Base:** origin/main (`9093e0c`)
- **Head:** `8e0833b` (feat/inventory-list-server-side-filters)
- **PR #:** 64
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** 5 files, 132 insertions, 2 deletions. Small, focused feature PR. Full review feasible.

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 1, P2: 3, P3: 1

## Intent Verification

- **Stated intent:** Add four server-side filters to `purvey inventory list`: `--catalog-id`, `--purchase-date-start`, `--purchase-date-end`, `--origin`. Version bump 0.9.1 to 0.9.2.
- **What was implemented:** All four filters added to the Commander option definitions, Zod schema, lib function query builder, context reference, and help examples. Version bumped. Tests added for schema validation.
- **Coverage gaps:** None at the feature level. All four filters are wired end-to-end from CLI option through to Supabase query.

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

- **Title:** No date format validation for `--purchase-date-start` / `--purchase-date-end`
- **Evidence:** In `src/commands/inventory.ts` lines 78-79, the date strings are passed through as-is:
  ```ts
  purchaseDateStart: opts.purchaseDateStart as string | undefined,
  purchaseDateEnd: opts.purchaseDateEnd as string | undefined,
  ```
  The Zod schema in `src/lib/inventory.ts` declares these as `z.string().optional()` with no regex or date refinement. Contrast with `src/commands/roast.ts` lines 85-94 which validates both `--date-start` and `--date-end` against `/^\d{4}-\d{2}-\d{2}$/` and throws a `PrvrsError('INVALID_ARGUMENT', ...)` with a clear message.
- **Impact:** Users passing malformed dates (e.g. `--purchase-date-start "March 1"` or `--purchase-date-start 2026/03/01`) will silently produce zero results rather than a helpful error. Supabase's `.gte()` on a `date` column with a non-ISO string returns no rows without an error. This is a silent-failure data quality issue.
- **Correction:** Add format validation in the command handler (matching the roast.ts pattern) or add a Zod `.regex()` refinement in the schema. Prefer the command handler approach for consistency with the existing roast command pattern:
  ```ts
  // In src/commands/inventory.ts, before calling listInventory:
  if (opts.purchaseDateStart && !/^\d{4}-\d{2}-\d{2}$/.test(opts.purchaseDateStart as string)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid --purchase-date-start: "${opts.purchaseDateStart}". Must be YYYY-MM-DD format.`
    );
  }
  if (opts.purchaseDateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(opts.purchaseDateEnd as string)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid --purchase-date-end: "${opts.purchaseDateEnd}". Must be YYYY-MM-DD format.`
    );
  }
  ```

### P2 (important improvements)

- **Title:** Origin filter sub-query is not scoped to user
- **Evidence:** In `src/lib/inventory.ts` lines 147-155, the origin filter queries `coffee_catalog` without any user scope:
  ```ts
  const { data: catalogRows, error: catError } = await supabase
    .from('coffee_catalog')
    .select('id')
    .ilike('country', `%${safe}%`);
  ```
  This is functionally correct because `coffee_catalog` is a shared table (not per-user). However, this means the `catalogIds` array could contain hundreds of IDs for popular origins (e.g. "Ethiopia" might match 200+ catalog entries), which results in a large `.in()` filter on the main query.
- **Impact:** Performance concern for popular origins. Supabase/PostgREST `.in()` with hundreds of IDs generates a very long URL query parameter. PostgREST has URL length limits (typically 8KB). For a catalog with 1,258+ rows, querying "Ethiopia" could produce a 50+ ID `in()` clause. Not a correctness bug today, but could become one as the catalog grows.
- **Correction:** This is an acceptable trade-off for the current catalog size. For future-proofing, consider documenting the scaling limitation. If the catalog grows past ~5K rows, refactor to use a Supabase RPC that does the join server-side. No immediate code change required; just awareness.

---

- **Title:** Missing test for `listInventory` function behavior (integration-level)
- **Evidence:** All 14 new tests in `tests/inventory.test.ts` validate only the Zod schema (`listInventorySchema.parse()`). No tests exercise the actual `listInventory()` function's query-building logic, the origin sub-query path, or the early-return-empty-array behavior when no catalog matches are found.
- **Impact:** Schema tests confirm input validation but not the query assembly or sub-query logic. The origin filter's early return (`return []` when no catalog IDs match) and the `.in()` wiring are untested. A future refactor could break query assembly without test failure.
- **Correction:** Add integration-style tests (with a mocked or stubbed Supabase client) covering:
  1. `listInventory()` passes `catalog_id` to `.eq()` when `catalogId` is set
  2. `listInventory()` applies `.gte()`/`.lte()` for date filters
  3. `listInventory()` returns `[]` when origin matches no catalog entries
  4. `listInventory()` passes matched IDs to `.in()` for origin filter

  This can be deferred to a follow-up PR but should be tracked.

---

- **Title:** Inconsistent truthiness check: `purchaseDateStart` vs `catalogId`
- **Evidence:** In `src/lib/inventory.ts`:
  - `catalogId` uses `parsed.catalogId !== undefined` (strict check, line 137)
  - `purchaseDateStart` uses `parsed.purchaseDateStart` (truthy check, line 139)
  - `purchaseDateEnd` uses `parsed.purchaseDateEnd` (truthy check, line 142)
  - `origin` uses `parsed.origin` (truthy check, line 146)

  Since all three string fields are `z.string().optional()`, their parsed values are either `undefined` or a string. An empty string `""` would be truthy-falsy, but Commander won't produce `""` for `<YYYY-MM-DD>` arguments (it would be `undefined` if not provided). So this is safe in practice.

- **Impact:** Stylistic inconsistency, not a bug. If the lib function is ever called programmatically with `{ purchaseDateStart: "" }`, it would silently skip the filter, which could be surprising.
- **Correction:** Standardize to `!== undefined` checks for consistency with `catalogId`. Low priority.

### P3 (nice to have)

- **Title:** Help text could note that `--origin` is a partial, case-insensitive match
- **Evidence:** The Commander `.option()` description says `'Filter by country of origin (partial match)'` but doesn't mention case-insensitivity. The context.ts reference says just `--origin <country>` with no qualification.
- **Impact:** Minimal. Users who try `--origin ethiopia` (lowercase) will get correct results, but the help text doesn't set that expectation.
- **Correction:** Update the option description to `'Filter by country of origin (partial match, case-insensitive)'`. Already partially done in the option definition but missing from context.ts.

## Assumptions Review

| Assumption                                                                           | Validity | Rationale                                                                                                      | Action                                                  |
| ------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `coffee_catalog.country` stores country names (not ISO codes)                        | Valid    | Verified in catalog.ts types and search patterns; ilike on names is consistent                                 | None                                                    |
| `green_coffee_inv.purchase_date` is a date-type column (ISO string comparison works) | Valid    | Used consistently across inventory add/update; Supabase gte/lte on date columns accepts ISO strings            | None                                                    |
| `sanitizeFilterValue` from catalog.ts is sufficient for origin input                 | Valid    | Strips PostgREST special chars `(),.* %`; prevents injection in ilike pattern                                  | None                                                    |
| `catalog_id` on inventory is the FK to `coffee_catalog.id`                           | Valid    | Confirmed by INVENTORY_LIST_SELECT join: `coffee_catalog!catalog_id (...)`                                     | None                                                    |
| `.in()` with a large array of IDs will work within PostgREST limits                  | Weak     | Works for current catalog size (~1,258 rows) but PostgREST URL length limits could be hit with larger catalogs | Document limitation; revisit if catalog exceeds 5K rows |
| Users provide valid ISO dates when using date filters                                | Weak     | No validation enforces this; malformed input silently returns no results                                       | Fix (P1)                                                |

## Tech Debt Notes

- **Debt introduced:** Minor; the origin sub-query pattern adds one extra Supabase call per `list` invocation when `--origin` is used. Acceptable for current scale.
- **Debt worsened:** None. The PR follows the established sub-query pattern from roast.ts.
- **Suggested follow-up tickets:**
  1. Add date format validation to purchase-date filters (P1, should fix in this PR)
  2. Add integration-level tests for `listInventory()` query building (P2, can be separate PR)
  3. If catalog grows past ~5K rows, refactor origin filter to server-side RPC join

## Product Alignment Notes

- **Alignment wins:** All four filters address real user needs. `--origin` with partial match is user-friendly. The sub-query approach matches the roast.ts precedent, maintaining architectural consistency.
- **Misalignments:** None. The feature set matches what a coffee inventory power user (or agent) would need.
- **Suggested product checks:** None required. This is a straightforward query filter addition.

## Test Coverage Assessment

- **Existing tests that validate changes:** 14 new schema tests covering all four filter fields, including type rejection, default values, combination scenarios, and edge cases (non-positive, non-integer catalogId). All 330 tests pass.
- **Missing tests:**
  1. Integration test for `listInventory()` query assembly with new filters
  2. Integration test for origin sub-query early-return (no matches)
  3. Date format validation (once added) error path
- **Suggested test additions:** See P2 finding above. Schema tests are thorough; query behavior tests are the gap.

## Minimal Correction Plan

1. **[P1] Add date format validation** in `src/commands/inventory.ts` before the `listInventory()` call, matching the roast.ts pattern. Add corresponding test for the error path.

## Optional Patch Guidance

### `src/commands/inventory.ts`

Insert after `catalogId` validation block (after the `isNaN(catalogId)` check, before the `listInventory()` call):

```ts
if (opts.purchaseDateStart && !/^\d{4}-\d{2}-\d{2}$/.test(opts.purchaseDateStart as string)) {
  throw new PrvrsError(
    'INVALID_ARGUMENT',
    `Invalid --purchase-date-start: "${opts.purchaseDateStart}". Must be YYYY-MM-DD format.`
  );
}
if (opts.purchaseDateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(opts.purchaseDateEnd as string)) {
  throw new PrvrsError(
    'INVALID_ARGUMENT',
    `Invalid --purchase-date-end: "${opts.purchaseDateEnd}". Must be YYYY-MM-DD format.`
  );
}
```

### `src/commands/context.ts`

No changes needed (context text already updated).

### `src/lib/inventory.ts`

P2 items only; no required changes for merge.
