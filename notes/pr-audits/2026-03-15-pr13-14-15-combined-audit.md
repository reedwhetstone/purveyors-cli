# PR Verification Report: PRs #13, #14, #15 Combined Audit

## Metadata

- **Repo:** reedwhetstone/purveyors-cli
- **Base:** f952fcc (previous main, after PR #12)
- **Head:** 908b3e0 (current main, post-merge of PRs #13-#15)
- **PRs audited:** #13 (roast import), #14 (audit P1/P2 fixes), #15 (interactive forms + config)
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Combined audit of 3 merged PRs. 20 files changed, +1,217 / -154 lines.

## Executive Verdict

- **Merge readiness:** Ready with fixes (already merged; issues should be addressed in follow-up)
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 3, P2: 5, P3: 4

## Intent Verification

### PR #13: Roast Import Command

- **Stated intent:** Add `purvey roast import <file>` as a one-step import that creates roast profile + imports .alog data. Weight extraction with unit conversion. Auto-generated batch names.
- **What was implemented:** `importRoastFromFile` creates the roast profile row first (with coffee_id FK), then calls `importArtisanData` to populate temps/events/metadata. `extractOzFromAlog` handles g/oz/kg/lb conversion. `defaultBatchName` generates "{coffee_name} {YYYY-MM-DD}".
- **Coverage gaps:** None. Intent fully satisfied.

### PR #14: Audit P1/P2 Fixes

- **Stated intent:** sanitizeFilterValue adds %, process filter sanitized, import error handling improved, `|| null` to `?? null`, temp1/temp2 comments fixed.
- **What was implemented:** All five items addressed. `sanitizeFilterValue` now strips `%`. `process` filter in `searchCatalog` runs through `sanitizeFilterValue`. Import wraps temp/event inserts in try/catch with partial-failure messaging. 30+ `|| null` replaced with `?? null`. temp1/temp2 comments corrected to ET/BT.
- **Coverage gaps:** None. All P1/P2 items from prior audit resolved.

### PR #15: Interactive Forms + Config

- **Stated intent:** Add `--form` flag to all write commands using @clack/prompts. Bean/roast/catalog pickers. Config system for `form-mode` setting.
- **What was implemented:** `--form` added to inventory add, roast create, roast import, sales record, tasting rate. Shared pickers in `src/lib/interactive/forms.ts`. Config system at `src/lib/config.ts` + `src/commands/config.ts` with get/set/list/reset.
- **Coverage gaps:** See P1-1 below (config auto-form-mode not wired).

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

#### P1-1: `form-mode` config is stored but never consumed

**Evidence:** `src/lib/config.ts` defines `form-mode` config key. `src/commands/config.ts` lets users set it. The help text says "when true, write commands auto-enter form mode if required args are missing." But NO write command reads this config value. `grep -rn 'readConfig\|getConfigValue\|form-mode' src/commands/` only shows hits in `config.ts` itself; inventory.ts, roast.ts, sales.ts, tasting.ts never import or check it.

**Impact:** Users who run `purvey config set form-mode true` will see a success message but the behavior won't change. This is a broken promise in the help text. Commands still require explicit `--form` flag.

**Correction:** In each write command, after auth check and before the `if (opts.form)` block, add a check:

```typescript
const config = await readConfig();
if (!opts.form && config['form-mode'] && !opts.coffeeId /* required args missing */) {
  opts.form = true;
}
```

Or simpler: if `form-mode` is true, treat missing required args as a signal to enter form mode.

#### P1-2: Sales form collects `notes` but discards them

**Evidence:** `src/commands/sales.ts` line ~133: `void String(notesRaw);` with comment "notesStr captured for future use when sales lib supports notes field". The `Sale` type has no `notes` column. The sales table schema does not have a notes column.

**Impact:** User enters notes in the form, sees them accepted, but they silently disappear. This is a UX lie. The `--notes <text>` flag option is also defined but unused.

**Correction:** Either (a) remove the notes prompt and `--notes` option until the DB supports it, or (b) add a `notes` column to the sales table. Option (a) is lower risk.

#### P1-3: Sales form auto-selects most recent roast without user confirmation

**Evidence:** `src/commands/sales.ts` lines ~145-160. When using `--form`, the user picks a bean, then the code silently looks up the most recent `roast_profiles` row for that `coffee_id` and uses its `roast_id`. There is no prompt telling the user which roast was selected or letting them pick a different one.

**Impact:** If a user has multiple roasts of the same bean (common for regular roasters), the sale is silently attributed to the most recent roast. This could be wrong. The `pickRoast` function exists in forms.ts but is never imported or used in sales.ts.

**Correction:** After finding the most recent roast, show the user which roast was selected and offer a "pick a different roast" option, or simply use `pickRoast()` instead of the auto-lookup. The `pickRoast` picker already exists and is unused.

### P2 (important improvements)

#### P2-1: Inventory form skips `--tax-ship` and `--purchase-date` prompts

**Evidence:** `src/commands/inventory.ts` form mode prompts for catalog-id, qty, cost, notes. It hard-codes `purchaseDate: todayIso()` and never prompts for tax/shipping cost, despite both being available as CLI flags.

**Impact:** Users using `--form` mode can't enter tax/shipping costs or backdate purchases. Minor data gap for power users.

**Correction:** Add optional prompts for tax/shipping and purchase date in the form flow.

#### P2-2: Tasting form skips `--brew-method` prompt

**Evidence:** `src/commands/tasting.ts` form mode prompts for bean, five cupping scores, and notes. It does not prompt for brew method, even though `--brew-method` is defined as a CLI flag.

**Impact:** Form users can't record brew method. The `rateCoffee` call in form mode never passes `brewMethod`.

**Correction:** Add a brew-method prompt to the tasting form.

#### P2-3: Roast form skips `--oz-out` prompt

**Evidence:** `src/commands/roast.ts` form mode prompts for coffee, batch name, oz-in, notes, and targets. It does not prompt for oz-out (roasted weight). The `createRoast` lib supports `ozOut`.

**Impact:** Users can't record post-roast weight in form mode. Weight loss percent can't be calculated.

**Correction:** Add oz-out prompt to the roast create form.

#### P2-4: No test coverage for `%` in sanitizeFilterValue

**Evidence:** `tests/lib.test.ts` tests sanitizeFilterValue for `(`, `)`, `,`, `.`, `*` but not `%`. The PR #14 fix specifically added `%` to the character class.

**Impact:** Low risk (the code is correct), but the test suite doesn't verify the specific fix. Future regression could go unnoticed.

**Correction:** Add `expect(sanitizeFilterValue('100%')).toBe('100');` to the test.

#### P2-5: No integration tests for form flows (acknowledged limitation)

**Evidence:** `tests/forms.test.ts` only tests config round-trips and module exports. Comment: "We do NOT test interactive prompts themselves (they need a TTY)." The 131 tests include 0 tests that exercise the form code paths.

**Impact:** All form mode flows are untested. Regressions in form validation, picker queries, or cancel handling would not be caught.

**Correction:** Consider using vitest mocking to stub `@clack/prompts` and test form logic without a TTY. This would cover: cancel paths, validation logic, Supabase query construction in pickers.

### P3 (nice to have)

#### P3-1: Duplicated authentication boilerplate across form and flag paths

**Evidence:** `src/commands/roast.ts` import form mode (lines ~273-294) creates its own `supabase` and `user` check, duplicating the auth block that already exists at the top of the non-form path. The outer handler already creates the client for non-import commands.

**Impact:** Minor code duplication. The import command's form path authenticates inside the form flow rather than before `p.intro()`, meaning a user could go through file path and bean selection prompts only to discover they're not logged in.

**Correction:** Move auth check before `p.intro()` in the import form path (consistent with other commands). Or extract a shared auth helper.

#### P3-2: `readConfig` silently returns `{}` on JSON parse errors

**Evidence:** `src/lib/config.ts` readConfig catches ALL errors including JSON.parse failures. A corrupted config.json returns `{}` silently.

**Impact:** Users with a corrupted config file get no warning. Edge case.

**Correction:** Catch parse errors specifically and log a warning.

#### P3-3: Picker limit of 50 items may truncate long inventories

**Evidence:** `pickBean` and `pickRoast` both use `.limit(50)`. Users with large inventories/roast histories won't see older items.

**Impact:** Power users with extensive history can't access older items via the form picker.

**Correction:** Add a "search by name" option or pagination, or increase the limit for interactive mode.

#### P3-4: `pickCatalogItem` exits process on no results instead of allowing retry

**Evidence:** `src/lib/interactive/forms.ts` line ~173: `p.cancel(...)` + `process.exit(0)` when search returns no results. Same pattern for `pickBean` and `pickRoast` with empty data.

**Impact:** User has to re-run the entire command if their search term doesn't match. A "try again?" prompt would be friendlier.

**Correction:** Wrap in a retry loop or offer to search again.

## Assumptions Review

| Assumption                                                   | Validity  | Why                                                                                                                                                                      | Recommended Action                                                 |
| ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `coffee_id` in roast_profiles is FK to `green_coffee_inv.id` | **Valid** | Verified via `createRoast` which checks ownership via `green_coffee_inv` query before insert                                                                             | None                                                               |
| Artisan temp1 = ET, temp2 = BT                               | **Valid** | This matches Artisan's documented channel mapping. The `normalizeArtisanTemperatures` function in temperature.ts correctly maps temp2 to beanTemps and temp1 to envTemps | None                                                               |
| Sales table has no `notes` column                            | **Weak**  | The form collects notes and the CLI defines `--notes`, suggesting intent to add it                                                                                       | Verify DB schema; remove or add                                    |
| `form-mode` config will be wired up later                    | **Weak**  | Config is functional, help text promises behavior, but no consumption exists                                                                                             | Wire it up or remove the help text promise                         |
| Supabase REST API doesn't support transactions               | **Valid** | Documented limitation. The clear-then-insert pattern in `importArtisanData` is the correct workaround                                                                    | The improved error handling (PR #14) mitigates the risk adequately |
| `process.exit(0)` is appropriate for cancel/empty-picker     | **Valid** | Standard CLI pattern. @clack/prompts examples use this pattern. The exit code 0 is correct for user-initiated cancellation                                               | None                                                               |

## Tech Debt Notes

- **Debt introduced:**
  - `pickRoast` function is exported but never consumed (dead code). It exists for future use but currently adds maintenance surface.
  - `--notes` option on `sales record` is defined but unused (confusing).
  - `form-mode` config key is fully implemented but not wired to commands (half-finished feature).

- **Debt worsened:**
  - Form mode duplicates field definitions: CLI flags define options (e.g., `--oz-in`), and form prompts re-define the same fields with separate validation. Changes to field constraints need updating in two places.

- **Suggested follow-up tickets:**
  1. Wire `form-mode` config to write commands (P1-1)
  2. Use `pickRoast` in sales form or remove it (P1-3)
  3. Remove `--notes` from sales until DB supports it (P1-2)
  4. Add missing form prompts for tax-ship, brew-method, oz-out (P2-1, P2-2, P2-3)
  5. Add `%` test case for sanitizeFilterValue (P2-4)
  6. Investigate mocked form tests (P2-5)

## Product Alignment Notes

- **Alignment wins:**
  - Form mode is a great UX improvement for interactive use. The picker pattern (bean/roast/catalog search) is intuitive and well-implemented.
  - The import command's one-step flow (create profile + import data) is exactly what a roaster wants.
  - `guardCancel` pattern ensures Ctrl+C always exits cleanly; no dangling state.
  - Config system is clean and extensible (adding new keys is straightforward).

- **Misalignments:**
  - Sales form's auto-roast-selection conflicts with "attribute sale to a specific roast" use case. A user selling bags from two different roasts of the same bean can't distinguish them.
  - The `form-mode` config being inert means users who follow the help text will be confused.

- **Suggested product checks:**
  - Validate with Reed whether the sales form UX (auto-select most recent roast) is acceptable or if explicit roast picking is preferred.
  - Confirm whether the config auto-form-mode behavior should be implemented now or deferred.

## Test Coverage Assessment

- **Existing tests that validate changes:**
  - `roast-import.test.ts`: 20 tests cover `importRoastSchema`, `extractOzFromAlog` (all unit conversions, edge cases), `defaultBatchName`. Thorough.
  - `lib.test.ts`: 4 tests for `sanitizeFilterValue` (covers `(`, `)`, `,`, `.`, `*`). Missing `%`.
  - `forms.test.ts`: 13 tests cover config key validation, config set validation, JSON round-trips, module export checks, and command structure. Necessary baseline.

- **Missing tests:**
  - `%` character in `sanitizeFilterValue` (P2-4)
  - No form flow tests (picker queries, cancel paths, validation sequences)
  - No tests for `importRoastFromFile` integration (the full create-profile-then-import flow)
  - No tests for the `|| null` to `?? null` behavioral change (specifically for falsy-but-valid values like `0`)

- **Suggested test additions:**
  1. `sanitizeFilterValue('%')` returns `''`
  2. `sanitizeFilterValue('100%')` returns `'100'`
  3. Mock-based test for `pickBean` query construction and cancel handling
  4. Test that `beanTemps[index] ?? null` preserves `0` (where `|| null` would have erased it)
  5. Integration test for `importRoastFromFile` with mocked Supabase

## Minimal Correction Plan

1. **Wire `form-mode` config** into write commands, or remove the help text that promises the behavior (P1-1)
2. **Remove `--notes` flag and notes prompt** from `sales record` until the DB schema supports it (P1-2)
3. **Replace auto-roast-lookup** in sales form with `pickRoast()` picker, or show the user which roast was selected and let them override (P1-3)
4. **Add `%` test** to sanitizeFilterValue tests (P2-4)

## Optional Patch Guidance

### P1-1: Wire form-mode config

- **Files:** `src/commands/inventory.ts`, `src/commands/roast.ts`, `src/commands/sales.ts`, `src/commands/tasting.ts`
- **Pattern:** At the top of each command action (after auth check), before the `if (opts.form)` block:
  ```typescript
  import { readConfig } from '../lib/config.js';
  // ...
  if (!opts.form) {
    const cfg = await readConfig();
    if (cfg['form-mode']) opts.form = true;
  }
  ```

### P1-2: Remove orphan notes from sales

- **File:** `src/commands/sales.ts`
- **Remove:** The `--notes` option definition, the `notesRaw` prompt in form mode, and the `void String(notesRaw)` line.

### P1-3: Use pickRoast in sales form

- **File:** `src/commands/sales.ts`
- **Replace:** The auto-lookup query (lines ~145-160) with:
  ```typescript
  import { pickBean, pickRoast, guardCancel } from '../lib/interactive/forms.js';
  // In form mode, after pickBean:
  const roast = await pickRoast(supabase, user.id);
  const roastId = roast.id;
  ```
  Or filter pickRoast by coffee_id if the user should first pick a bean then a roast of that bean.

### P2-4: Add % test

- **File:** `tests/lib.test.ts`
- **Add to** the `sanitizeFilterValue` describe block:
  ```typescript
  it('removes percent sign', () => {
    expect(sanitizeFilterValue('100%')).toBe('100');
    expect(sanitizeFilterValue('%wildcard%')).toBe('wildcard');
  });
  ```
