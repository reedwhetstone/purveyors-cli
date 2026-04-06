# PR Verification Report

## Metadata

- **Repo:** purveyors-cli
- **Base:** origin/main (2748ddd)
- **Head:** f88c5f3 (feat/inventory-delete-dependency-check)
- **PR #:** 68
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Single commit, 6 files changed (595+, 11-). Clean scope; all changes are reviewable.

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 1, P2: 3, P3: 2

## Intent Verification

- **Stated intent:** Fix DEVLOG Priority 1: raw PostgreSQL FK violation on `purvey inventory delete <id>` when dependents exist. Add pre-flight check, `--force` cascade, `--force --yes` for non-interactive use, updated return type, updated context docs, 14 new unit tests.
- **What was implemented:** All six items from the intent are present and correctly wired:
  1. Pre-flight dependency check with PrvrsError('DEPENDENCY_CONFLICT') including counts and `--force` hint: **Implemented** in `src/lib/inventory.ts`
  2. `--force` flag with cascade (sales -> roasts -> inventory): **Implemented** in both lib and command layers
  3. `--force --yes` skips confirmation: **Implemented** via commander option parsing
  4. `DeleteInventoryResult` return type: **Implemented** and exported
  5. `context.ts` updated: **Implemented** with `--force` documentation
  6. 14 new unit tests: **Implemented** in `tests/inventory-delete.test.ts`, all passing
- **Coverage gaps:** None on stated intent. One behavioral gap identified below (P1).

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

**1. `fatal()` does not emit structured JSON for errors in `--json`/`--pretty` mode**

- **Evidence:** `src/lib/errors.ts` lines 37-50: `fatal()` always writes `chalk.red(✖ message)` to stderr and calls `process.exit(1)`. When a user runs `purvey inventory delete 5 --json` and hits `DEPENDENCY_CONFLICT`, the error output is a plain-text chalk-colored string, not structured JSON. The acceptance criterion states: "Error code `DEPENDENCY_CONFLICT` is returned in JSON error output (consistent with `PrvrsError` pattern)."
- **Impact:** Agent/script consumers using `--json` mode cannot reliably parse the error code programmatically. They must scrape stderr for the error message text instead. This is specifically called out in the PR's own acceptance criteria.
- **Correction:** This is a pre-existing architectural gap in `fatal()`, not something this PR introduced. However, the PR's acceptance criteria explicitly claims JSON error output. Two options:
  - (a) Update `fatal()` to detect `--json`/`--pretty` from the Commander context and emit `{"error": true, "code": "DEPENDENCY_CONFLICT", "message": "..."}` to stdout (or stderr) as JSON. This benefits all error paths, not just this PR.
  - (b) Remove the acceptance criterion claim about JSON error output from the plan doc, acknowledging it as tech debt, and file a follow-up issue.
  - Recommended: option (b) for this PR, option (a) as a separate follow-up. The PR is already a clean, scoped fix; bolting on error formatting infrastructure risks scope creep.
- **Classification:** Confirmed gap. The acceptance criterion is unmet, but the root cause is pre-existing architecture, not a regression.

### P2 (important improvements)

**2. `--force` confirmation prompt does not show actual dependency counts**

- **Evidence:** `src/commands/inventory.ts` line 393: `confirm('Delete inventory item ${itemId} and all its dependent roast profiles and sales records?')`. This is a generic message. The implementation plan (line 59-63) specifies a summary like "This will also delete: 3 roast profiles, 2 sale records". The actual counts are only known after the lib function's pre-flight check runs, but the confirmation prompt fires _before_ `deleteInventory()` is called.
- **Impact:** Users see "all its dependent roast profiles and sales records" without knowing there are 3 of one and 2 of the other. Lower-fidelity UX than the plan specified. The lib layer has the counts; the command layer prompts before calling the lib.
- **Correction:** Either:
  - (a) Extract the count-checking logic into a separate exported function (e.g., `checkInventoryDependencies(supabase, userId, id)`) that the command layer calls before prompting, then passes the result into `deleteInventory()` to avoid double-querying. This is the clean approach.
  - (b) Accept the generic prompt as "good enough for v1" and file a follow-up. The `--force` path is inherently destructive, so any confirmation is better than none.
- **Classification:** Confirmed deviation from spec. Minor UX gap.

**3. Non-atomic cascade: partial deletion possible on mid-sequence failure**

- **Evidence:** `src/lib/inventory.ts` lines 377-395. The cascade deletes sales, then roast profiles, then the inventory item as three separate Supabase calls. If the roast profile delete fails after sales are already deleted, the operation is left in a partially completed state (sales gone, roasts and inventory still present).
- **Impact:** This is an edge case (Supabase/Postgres errors mid-cascade are rare), but the plan doc explicitly says "one atomic sequence" (line 69: "cascades: deletes sales, then roast profiles, then the inventory item in one atomic sequence"). The implementation is sequential but not transactional.
- **Correction:** Supabase's JS client doesn't support client-side transactions. Two options:
  - (a) Create an RPC function (`cascade_delete_inventory`) in Supabase that wraps all three deletes in a `BEGIN`/`COMMIT` block. Cleanest, but requires a schema migration.
  - (b) Document the limitation explicitly: "Note: cascade deletion is sequential, not transactional. In the unlikely event of a mid-cascade failure, some dependents may already be deleted." Add this to the help text and JSDoc.
  - Recommended: (b) for this PR, (a) as follow-up if atomicity becomes important.
- **Classification:** Confirmed limitation. Low practical risk, but contradicts the "atomic" claim in the plan doc.

**4. Tests use shared mutable state in the mock chain object**

- **Evidence:** `tests/inventory-delete.test.ts` lines 17-73. The `makeSupabase()` factory creates a single `chain` object with `currentTable` and `isCountQuery`/`isDeleteQuery` as mutable state in the closure. All `.from()` calls share this single chain instance. The `then()` mock resolves based on `currentTable` at the moment `then` is called.
- **Impact:** The mock works correctly for the current tests because each test awaits each Supabase call sequentially (the lib function does this naturally). However, if future tests or code changes introduce concurrent Supabase queries (e.g., `Promise.all([countRoasts, countSales])`), the shared mutable state will cause race conditions in tests. The mock is fragile for maintenance.
- **Correction:** This is acceptable for now given the sequential nature of the code. Consider refactoring to per-table mock instances if the pattern gets reused. No action required for this PR, but worth noting for future maintainers.
- **Classification:** Concern (not a defect). Current tests pass reliably; fragility is theoretical.

### P3 (nice to have)

**5. Pluralization logic duplicated between lib and command layers**

- **Evidence:** `src/lib/inventory.ts` lines 365-368 and `src/commands/inventory.ts` lines 410-414. Both construct "N roast profile(s)" / "N sale record(s)" strings with identical pluralization logic. Copy-paste duplication.
- **Impact:** Minor maintenance burden. If the entity names change or a third dependent type is added, both locations need updating.
- **Correction:** Extract a small helper, e.g.:
  ```ts
  function pluralize(count: number, singular: string, plural?: string): string {
    return `${count} ${count === 1 ? singular : (plural ?? singular + 's')}`;
  }
  ```
  Or just accept the duplication for two occurrences. Not worth blocking the PR.

**6. `void cmd;` removal without explanation**

- **Evidence:** The diff shows the old code had `void cmd;` (line 383 in the original) which was replaced by `const globalOpts = cmd.optsWithGlobals() as OutputOptions;`. The `void cmd;` pattern was used to suppress unused-variable warnings when `cmd` wasn't needed. Now that `cmd` is used, this is correct, but it's a pattern other commands may still use.
- **Impact:** None. This is cosmetically correct. Just noting the pattern shift.

## Assumptions Review

| #   | Assumption                                                                 | Validity  | Why                                                                                                                                                                                         | Action                                             |
| --- | -------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `roast_profiles.coffee_id` references `green_coffee_inv.id`                | **Valid** | Plan doc confirms FK, and the pre-existing code already referenced this relationship                                                                                                        | None                                               |
| 2   | `sales.green_coffee_inv_id` references `green_coffee_inv.id`               | **Valid** | Same confirmation via plan doc and schema knowledge                                                                                                                                         | None                                               |
| 3   | `roast_temperatures` and `roast_events` cascade on roast profile delete    | **Valid** | Plan doc Q1 confirms `ON DELETE CASCADE` on these child tables                                                                                                                              | None                                               |
| 4   | User-scoped `.eq('user', userId)` on sales and roast_profiles is correct   | **Valid** | Matches the existing RLS pattern used throughout the codebase (see `updateInventory`, `getInventory`)                                                                                       | None                                               |
| 5   | Count queries with `{ count: 'exact', head: true }` return accurate counts | **Valid** | Standard Supabase pattern for counting without fetching rows                                                                                                                                | None                                               |
| 6   | No other tables reference `green_coffee_inv.id` beyond roasts and sales    | **Weak**  | The code only checks two FK relationships. If a future table (e.g., `blends`, `cupping_sessions`) references this ID, the pre-flight check will miss it and the raw PG error will resurface | Document the assumption; revisit if schema evolves |
| 7   | `--force` without `--yes` always has a TTY for the confirmation prompt     | **Valid** | The `confirm()` utility from `src/lib/prompts.ts` handles non-TTY gracefully (likely defaults to aborting)                                                                                  | Verify behavior in non-TTY                         |

## Tech Debt Notes

- **Debt introduced:**
  - Pluralization duplication (minor, P3)
  - Non-transactional cascade claiming "atomic" behavior in the plan doc
- **Debt worsened:**
  - `fatal()` still doesn't produce structured JSON for error output in `--json` mode. This PR adds a new error code (`DEPENDENCY_CONFLICT`) that agents need to parse, making the lack of JSON error formatting slightly more painful.
- **Suggested follow-up tickets:**
  1. Structured JSON error output in `fatal()` for `--json` mode (benefits all error paths)
  2. Supabase RPC for transactional cascade delete (if atomicity becomes a requirement)
  3. Extract dependency-check into reusable function for command-layer access (enables count-aware prompts)

## Product Alignment Notes

- **Alignment wins:**
  - Error message is actionable: tells the user exactly what's blocking and what to do (`--force`)
  - `--force --yes` enables full agent/script automation
  - Return type gives callers a clear summary of what was removed
  - context.ts updated so the agent reference doc is accurate
- **Misalignments:**
  - Confirmation prompt doesn't show actual counts (generic "all its dependent..." instead of "3 roast profiles and 2 sale records")
- **Suggested product checks:**
  - Verify that coffee-app's delete flow (if it imports `deleteInventory`) handles the new return type. Currently `src/lib/index.ts` re-exports everything from `inventory.ts`, so coffee-app callers of the old `void` return type won't break (they'll just get a return value they didn't expect), but TypeScript callers expecting `void` may get a type error if they're strict.

## Test Coverage Assessment

- **Existing tests that validate changes:**
  - `tests/inventory-delete.test.ts`: 14 tests covering no-deps happy path, DEPENDENCY_CONFLICT for roasts/sales/both, singular/plural, force path with all combinations, ownership checks. All passing (14/14).
  - `tests/inventory.test.ts`: pre-existing schema validation tests still passing (covers `deleteInventorySchema`).
  - Full suite: 351 tests, 17 files, all green.
- **Missing tests:**
  - Error propagation: no test for when a count query fails (roastCountErr / salesCountErr). The code throws, but there's no test asserting the throw-through behavior.
  - Error propagation: no test for when a cascade delete fails mid-sequence (e.g., sales delete succeeds but roast delete fails). Would confirm partial-failure behavior.
  - `force: true` with no dependents: there IS a test for this (line 262-273), good.
  - Command-layer test: no test for the `--force` flag parsing, `--json` output of the result, or the success message format. These are integration-level, so absence is acceptable for a unit test file.
- **Suggested test additions:**
  1. `deleteInventory` throws when roast count query returns an error
  2. `deleteInventory` throws when sales count query returns an error
  3. `deleteInventory` with `force: true` throws when cascade sales delete fails (verifies error surfaces, not silently swallowed)

## Minimal Correction Plan

1. **[P1] Address the JSON error output acceptance criterion:** Either (a) implement structured JSON errors in `fatal()` (scope creep risk) or (b) remove the acceptance criterion from the plan doc and file a follow-up issue. Recommended: (b).
2. **[P2] Document the non-atomic cascade limitation:** Add a note to the `deleteInventory` JSDoc and/or the plan doc clarifying that the cascade is sequential, not transactional.
3. **[P2] Consider adding 2-3 error-path tests:** Count query failure, cascade mid-failure.

Items 1-2 are quick doc edits. Item 3 is optional but strengthens confidence.

## Optional Patch Guidance

### `src/lib/inventory.ts`

- JSDoc for `deleteInventory`: Add a note: "Note: the cascade deletion is sequential (sales, then roasts, then inventory). If a step fails, prior deletions are not rolled back."
- No code changes required for merge.

### `notes/implementation-plans/2026-04-02-inventory-delete-dependency-check.md`

- Line 69: Change "one atomic sequence" to "one sequential operation" (accuracy)
- Acceptance criteria: Either mark the JSON error output criterion as deferred or add a note that it's blocked on the `fatal()` JSON infrastructure ticket

### `tests/inventory-delete.test.ts`

- Add 2-3 tests for error propagation paths (count query error, cascade delete error)
- Example for count query error:
  ```ts
  it('throws when roast count query fails', async () => {
    const supabase = makeSupabase({
      green_coffee_inv: { data: { id: 5 }, error: null },
      roast_profiles_count: { count: null, error: { message: 'db error' } },
    });
    await expect(deleteInventory(supabase as never, 'user-1', 5)).rejects.toMatchObject({
      message: 'db error',
    });
  });
  ```
