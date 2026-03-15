# PR Verification Report: PRs #11 + #12 Combined Audit

## Metadata

- **Repo:** reedwhetstone/purveyors-cli
- **Base:** f952fcc (prior to PRs #11/#12)
- **Head:** origin/main (post-merge)
- **PR #:** 11 + 12 (combined)
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Full codebase audit of `src/lib/` (PR #11 subpath export restructure + PR #12 artisan pipeline extraction). All 18 lib files, 8 artisan files, package.json exports map, 7 test files (87 tests).

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 3, P2: 5, P3: 4

Both PRs accomplish their stated goals cleanly. The lib extraction is well-structured, Zod schemas are consistent with TS types, the artisan pipeline is comprehensive, and all 87 tests pass. The issues found are correctness/robustness concerns, not blockers.

## Intent Verification

### PR #11: Subpath Export Restructure

- **Stated intent:** Separate pure business logic into `src/lib/*.ts` modules with Zod schemas. Add `exports` map to package.json. Make functions importable by coffee-app.
- **What was implemented:** 5 domain modules (catalog, inventory, roast, sales, tasting) with Zod input schemas, TypeScript interfaces, and pure async functions accepting `SupabaseClient`. Barrel re-export via `src/lib/index.ts`. Package.json `exports` map with 8 subpath entries. Supporting modules (config, errors, output, prompts, supabase).
- **Coverage gaps:** None. All stated goals met.

### PR #12: Artisan Import Pipeline Extraction

- **Stated intent:** Extract artisan import pipeline from coffee-app into `src/lib/artisan/`. 6 files: types, parser, validator, temperature utils, DB write helpers, import orchestrator.
- **What was implemented:** 7 files (types, parser, validator, temperature, db, import, index). Full pipeline: parse .alog Python literals, validate structure, normalize temperatures (ET/BT swap), transform to DB format, batch insert with clear-before-write pattern.
- **Coverage gaps:** None. Actually exceeds stated scope (7 files vs 6; includes barrel export).

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

#### P1-1: `sanitizeFilterValue` does not strip `%` despite JSDoc claim

- **Evidence:** `src/lib/catalog.ts:76-79`. JSDoc says "Removes: ( ) , . _ % that have meaning in PostgREST filter syntax" but the regex is `/[(),._]/g`which does NOT include`%`.
- **Impact:** User input containing `%` passes through to `.or()` filter strings. While PostgREST parameterizes these internally (so no SQL injection), `%` is the ILIKE wildcard character. A user searching for origin `%` would match everything. More critically, the `%` character has meaning in PostgREST filter syntax and the function's contract promises to strip it.
- **Correction:** Change regex to `/[(),.*%]/g`. Also consider stripping `_` (single-char LIKE wildcard).

#### P1-2: `process` filter in `searchCatalog` is not sanitized

- **Evidence:** `src/lib/catalog.ts:126-128`. The `parsed.process` value is passed directly to `.ilike('processing', ...)` without calling `sanitizeFilterValue()`.
- **Impact:** While `.ilike()` is a parameterized Supabase method (safe from injection), the value can contain `%` and `_` LIKE wildcards, allowing users to craft broader-than-intended queries. This is inconsistent with the `origin` and `flavor` paths which do sanitize.
- **Correction:** Apply `sanitizeFilterValue(parsed.process)` before interpolation, matching the pattern used for `origin` and `flavor`.

#### P1-3: Import orchestrator has no transaction safety; partial failure leaves orphaned data

- **Evidence:** `src/lib/artisan/import.ts:424-470`. The `importArtisanData` function performs 4 sequential write operations: (1) update roast profile, (2) clear existing data, (3) insert temperatures, (4) insert events. If step 3 fails mid-batch (e.g., after inserting 500 of 1000 temperature rows), the old data has already been cleared (step 2) but only partial new data exists.
- **Impact:** A network error, timeout, or RLS failure during batch insert would leave the roast profile in an inconsistent state: profile metadata updated, old temperature/event data deleted, and only partial new data present. The user would see a corrupt roast with missing temperature curves.
- **Correction:** Reorder operations so clear + insert happen atomically. Options: (a) Use Supabase RPC with a PostgreSQL function that wraps all writes in a transaction, (b) reverse the order: insert new data first, then delete old data (tagged by `data_source`), (c) at minimum, wrap the sequence in a try/catch that re-inserts old data on failure. Option (a) is cleanest. Document the limitation if deferring.

### P2 (important improvements)

#### P2-1: `clearRoastData` results are not checked for errors

- **Evidence:** `src/lib/artisan/db.ts:43-55`. Both `.delete()` calls discard the result without checking for errors. If the delete fails (e.g., RLS policy blocks it), the code silently continues and then inserts duplicate data.
- **Impact:** Could result in duplicate temperature/event data if delete silently fails. The profile update above it does check errors, so this is an inconsistency.
- **Correction:** Check `{ error }` from both delete calls and throw on failure.

#### P2-2: Comment inconsistency in `types.ts` for temp1/temp2

- **Evidence:** `src/lib/artisan/types.ts:72-73`. The `ArtisanRoastData` interface comments say `temp1: number[] // Bean temperature (BT)` and `temp2: number[] // Environmental temperature (ET)`. But EVERYWHERE else in the codebase (normalizeArtisanTemperatures, import.ts, tests), temp1 is ET and temp2 is BT.
- **Impact:** Misleading documentation. A future contributor reading types.ts would get the mapping backwards. The `normalizeArtisanTemperatures` function JSDoc and the test `'swaps ET/BT correctly (temp1=ET, temp2=BT)'` are correct; types.ts is wrong.
- **Correction:** Fix the comments in types.ts to: `temp1: number[] // Environmental temperature (ET)` and `temp2: number[] // Bean temperature (BT)`.

#### P2-3: `computedData` values use `|| null` which converts `0` to `null`

- **Evidence:** `src/lib/artisan/import.ts:354-380`. Lines like `tp_time: computedData.TP_time || null` will convert a legitimate value of `0` to `null`. For computed metrics like `tp_time` (turning point at time 0 is possible), `AUC` (could theoretically be 0), or ROR values (0 rate of rise is valid), this is a subtle data loss bug.
- **Impact:** If any computed metric is legitimately `0`, it gets stored as `null` in the database. This is unlikely for most fields (AUC and ROR won't be 0 in practice) but `tp_time` at exactly 0 seconds is plausible.
- **Correction:** Use `computedData.TP_time ?? null` (nullish coalescing) instead of `|| null` throughout.

#### P2-4: Barrel export `src/lib/index.ts` does not re-export artisan module

- **Evidence:** `src/lib/index.ts` exports from catalog, inventory, roast, sales, and tasting. The artisan module is not included.
- **Impact:** A consumer using `import { ... } from '@purveyors/cli/lib'` cannot access artisan functions. They must use `@purveyors/cli/artisan` directly. This is a design choice, not a bug, but it breaks the promise of the barrel export being a "convenience" import for "all lib modules."
- **Correction:** Either add `export * from './artisan/index.js'` to `src/lib/index.ts`, or update the barrel export comment to explicitly note the exclusion. The subpath `./artisan` exists, so this is purely a DX question.

#### P2-5: Missing `types` field in package.json `exports` map

- **Evidence:** `package.json` exports map specifies only `.js` entry points. No `types` condition is provided for TypeScript consumers.
- **Impact:** When coffee-app imports from `@purveyors/cli/catalog`, TypeScript may not automatically resolve type declarations. The `declaration: true` in tsconfig generates `.d.ts` files, but without `"types"` conditions in the exports map, some bundlers and IDE setups (especially with `moduleResolution: "bundler"`) may fail to find them.
- **Correction:** Add `types` conditions to each export entry:
  ```json
  "./catalog": {
    "types": "./dist/lib/catalog.d.ts",
    "default": "./dist/lib/catalog.js"
  }
  ```

### P3 (nice to have)

#### P3-1: `BATCH_SIZE` is hardcoded at 100 with no documentation on why

- **Evidence:** `src/lib/artisan/db.ts:19`. `export const BATCH_SIZE = 100;`
- **Impact:** No issue today, but the value affects Supabase REST API payload size limits. If temperature arrays commonly have 1000+ points (which they do for typical roasts), this means 10+ sequential API calls. A batch size of 500 would reduce network round-trips by 5x.
- **Correction:** Document the reasoning (Supabase row limit? payload size?) or benchmark a larger batch size.

#### P3-2: Parser comment stripping only handles `"` strings, not `'` strings

- **Evidence:** `src/lib/artisan/parser.ts:90-120`. The `removeCommentsCarefully` function tracks `inString` state using `"` quotes only. Since .alog files use single quotes (Python syntax), a `#` inside a single-quoted string value would be incorrectly treated as a comment.
- **Impact:** Low. The function runs BEFORE `convertSingleQuotesToDouble`, so at that point the content still uses single quotes. The function only tracks `"` strings. In practice, `#` inside string values in .alog files is rare (hex colors in color arrays, which are already being nuked by `fixMalformedArrays`), but the ordering creates a theoretical edge case.
- **Correction:** Either (a) move comment stripping AFTER quote conversion, or (b) track both `'` and `"` quote states in `removeCommentsCarefully`.

#### P3-3: `parseArtisanFile` in `import.ts` is async but never awaits

- **Evidence:** `src/lib/artisan/import.ts:19`. Function is `async` but the body is entirely synchronous (calls `processAlogFile` and `JSON.parse`, both sync). The `await` on its call in `importArtisanData` is unnecessary.
- **Impact:** No functional issue; just unnecessary Promise wrapping and a misleading API.
- **Correction:** Remove `async` keyword from `parseArtisanFile` and remove `await` at the call site.

#### P3-4: Test fixture is minimal; no test for complex .alog files

- **Evidence:** `tests/fixtures/test-roast.alog` is a single-line minimal fixture with 5 data points. No tests for: nested single quotes in string values, unicode characters, very large arrays, files with Python comments, files with BOM, malformed color arrays (which the parser has special handling for).
- **Impact:** The parser has extensive defensive code (BOM removal, comment stripping, color array nuking, malformed array handling) that is completely untested.
- **Correction:** Add 3-4 more test fixtures exercising the defensive code paths: (a) file with Python comments, (b) file with BOM and unicode, (c) file with trailing commas and empty arrays, (d) file with single-quoted strings containing apostrophes.

## Assumptions Review

| Assumption                                               | Validity  | Why                                                                                                                                                                                                        | Recommended Action                                                                    |
| -------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Artisan temp1=ET, temp2=BT                               | **Valid** | Confirmed against Artisan source code and community docs. The normalizeArtisanTemperatures function handles this correctly.                                                                                | Fix misleading comments in types.ts (P2-2).                                           |
| Supabase .ilike() is parameterized (safe from injection) | **Valid** | Supabase JS client uses parameterized queries for all filter methods. The .or() string interpolation is the risk vector, and it IS sanitized.                                                              | Keep sanitization for .or() paths.                                                    |
| RLS policies enforce user ownership                      | **Weak**  | Code manually checks `profile.user !== userId` before writes. If RLS is properly configured, this check is redundant (but harmless). If RLS is NOT configured, the manual check is the only auth boundary. | Verify RLS policies in Supabase dashboard. The manual check is good defense-in-depth. |
| Token refresh via `setSession` is reliable               | **Valid** | Supabase `setSession` with refresh_token handles automatic refresh. The code persists rotated tokens. Error handling deletes stale creds.                                                                  | Solid implementation.                                                                 |
| Batch insert order doesn't matter for temperatures       | **Valid** | Temperature data is sorted by `time_seconds` before insert. Events are not explicitly sorted but this doesn't affect correctness since they're queried with ORDER BY.                                      | No action needed.                                                                     |
| `crypto.randomUUID()` is available                       | **Valid** | Node 20+ (engine requirement in package.json) supports `crypto.randomUUID()` natively.                                                                                                                     | No action needed.                                                                     |

## Tech Debt Notes

- **Debt introduced:**
  - Numerous `as` type casts on Supabase query results (35+ instances). This is standard practice with Supabase JS client which returns `any`-typed data, but it means type safety is trust-based at the DB boundary.
  - `cupping_notes: cupping as unknown as string` in tasting.ts is a double cast that hides a JSON-to-string type mismatch. The column likely accepts JSONB, but the cast pretends it's a string.
  - The parser has several "nuclear option" regex patterns for malformed arrays that are hard to reason about and untested.

- **Debt worsened:** None. This is greenfield extraction.

- **Suggested follow-up tickets:**
  1. Add Supabase database types generation (`supabase gen types`) to eliminate `as` casts at query boundaries
  2. Wrap import orchestrator writes in a Supabase RPC transaction (P1-3)
  3. Add complex .alog test fixtures (P3-4)
  4. Add `types` condition to exports map for proper TypeScript consumer DX (P2-5)

## Product Alignment Notes

- **Alignment wins:**
  - Clean separation of pure business logic from CLI concerns enables coffee-app to import directly
  - Artisan import pipeline preserves all data from .alog files (milestones, control events, computed metrics, phase calculations)
  - Temperature normalization stores everything in Fahrenheit for consistency
  - Import log table provides audit trail for debugging

- **Misalignments:** None.

- **Suggested product checks:**
  - Verify that coffee-app's existing Artisan import code (if any) is fully replaced by this extraction
  - Confirm the sampling strategy (limit to ~1000 temperature points) is acceptable for chart rendering quality

## Test Coverage Assessment

- **Existing tests that validate changes:**
  - `artisan.test.ts` (23 tests): parser, validator, temperature conversion, ET/BT swap, mode-to-unit conversion
  - `catalog.test.ts` (12 tests): computeCatalogStats pure function
  - `lib.test.ts` (16 tests): sanitizeFilterValue, searchCatalogSchema, rateCoffeeSchema, isValidCuppingScore
  - `output.test.ts` (12 tests): outputData formats, CSV, pretty, helpers
  - `prompts.test.ts` (10 tests): todayIso, confirm logic
  - `tasting.test.ts` (4 tests): filter validation
  - `write-commands.test.ts` (10 tests): cupping score validation, parseCuppingScore

- **Missing tests (ordered by risk):**
  1. **DB write functions** (insertTemperatures, insertEvents, clearRoastData): Zero test coverage. These are the most critical functions in the artisan pipeline.
  2. **transformArtisanData**: The core transformation logic (250+ lines) that produces the ProcessedRoastData has zero direct test coverage. Only tested indirectly through the parser/validator tests.
  3. **importArtisanData orchestrator**: No integration test. The full parse-validate-transform-write pipeline is untested.
  4. **Parser edge cases**: BOM handling, comment stripping, malformed arrays, apostrophes in single-quoted strings, very large files, unicode.
  5. **searchCatalog / listInventory / etc.**: Supabase-dependent functions have no tests (expected for integration tests, but mock-based unit tests are feasible).

- **Suggested test additions:**
  1. Add mock-Supabase tests for `insertTemperatures` / `insertEvents` to verify batch splitting and error propagation
  2. Add `transformArtisanData` unit test with the existing test fixture to verify milestone extraction, phase calculation, and temperature normalization end-to-end
  3. Add parser fixtures for edge cases (see P3-4)

## Minimal Correction Plan

1. **Fix `sanitizeFilterValue` regex** to include `%`: change `/[(),.*]/g` to `/[(),.*%_]/g` (P1-1)
2. **Sanitize `process` filter** in searchCatalog (P1-2)
3. **Fix temp1/temp2 comments** in types.ts (P2-2)
4. **Replace `|| null` with `?? null`** for computed data values (P2-3)
5. **Check errors from `clearRoastData` delete calls** (P2-1)
6. **Document the transaction safety limitation** of the import orchestrator with a TODO/ticket reference (P1-3, can defer the fix but should be documented)

## Optional Patch Guidance

### P1-1: `src/lib/catalog.ts:79`

```diff
- return value.replace(/[(),.*]/g, '');
+ return value.replace(/[(),.*%_]/g, '');
```

### P1-2: `src/lib/catalog.ts:126-128`

```diff
  if (parsed.process) {
-   query = query.ilike('processing', `%${parsed.process}%`);
+   const p = sanitizeFilterValue(parsed.process);
+   query = query.ilike('processing', `%${p}%`);
  }
```

### P2-2: `src/lib/artisan/types.ts:72-73`

```diff
- temp1: number[]; // Bean temperature (BT)
- temp2: number[]; // Environmental temperature (ET)
+ temp1: number[]; // Environmental temperature (ET) — Artisan convention
+ temp2: number[]; // Bean temperature (BT) — Artisan convention
```

### P2-3: `src/lib/artisan/import.ts:354-380` (all `|| null` to `?? null`)

```diff
- tp_time: computedData.TP_time || null,
+ tp_time: computedData.TP_time ?? null,
```

(Apply to all 14 computed data lines in this block)

### P2-1: `src/lib/artisan/db.ts:43-55`

```diff
- await supabase
+ const { error: tempDeleteError } = await supabase
    .from('roast_temperatures')
    .delete()
    .eq('roast_id', roastId)
    .eq('data_source', source);
+ if (tempDeleteError) throw tempDeleteError;

- if (source === 'artisan_import') {
-   await supabase
+ if (source === 'artisan_import') {
+   const { error: eventDeleteError } = await supabase
      .from('roast_events')
      .delete()
      .eq('roast_id', roastId)
      .in('category', ['milestone', 'control', 'machine']);
+ if (eventDeleteError) throw eventDeleteError;
```
