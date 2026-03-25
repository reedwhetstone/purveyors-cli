# Plan: Add Server-Side Filters to `listRoasts` (batch_name, roast_date range, stocked_only)

**Date:** 2026-03-24
**Slug:** listroasts-server-side-filters

---

## Problem Description

`listRoastsSchema` supports only two parameters: `coffee_id` and `limit`. But coffee-app's `roast_profiles` LLM tool has 10 input fields, most of which are silently applied client-side after fetching 3× the target limit:

```
// CLI listRoasts supports coffee_id filter directly; other filters applied client-side.
let profiles: RoastProfile[] = await listRoasts(supabase, userId, {
  coffee_id: input.coffee_id,
  limit: finalLimit * 3  // fetch more to allow for client-side filtering
});

// Client-side post-filters for params the CLI doesn't support yet
if (input.roast_id) { ... }
if (input.roast_name) { ... }
if (input.batch_name) { ... }
if (input.roast_date_start) { ... }
if (input.roast_date_end) { ... }
// stocked_only, catalog_id: not implemented at all
```

The current design fetches up to 45 rows (`finalLimit * 3` where `finalLimit` max = 15), then client-side filters down to the requested limit. This breaks when:

1. **Date-range queries:** A user asks "show me my roasts from last month." All matching roasts may be beyond the 45-row fetch window if the user has an extensive roast history.
2. **batch_name lookups:** Searching by batch name is a common agent pattern ("find my Ethiopia Guji Light roast"). It silently misses results past the 45-row fetch.
3. **stocked_only:** Currently ignored entirely. The LLM schema has it (default `true`), but `listRoasts()` never applies it. An agent asking "show my roasts for stocked beans" gets the same results as an agent asking for all historical roasts.
4. **catalog_id:** Also ignored entirely. An agent that resolves a catalog ID from `coffee_catalog_search` and passes it to `roast_profiles` gets unfiltered results.

### Impact Score

| LLM Field          | CLI Support | Failure Mode                                     |
| ------------------ | ----------- | ------------------------------------------------ |
| `roast_id`         | None        | Client-side; misses results past 45-row window   |
| `batch_name`       | None        | Client-side; misses results past 45-row window   |
| `roast_date_start` | None        | Client-side; misses results past 45-row window   |
| `roast_date_end`   | None        | Client-side; misses results past 45-row window   |
| `stocked_only`     | **None**    | Silently ignored; always returns all roasts      |
| `catalog_id`       | **None**    | Silently ignored; not even attempted client-side |

The two **bolded** cases (stocked_only, catalog_id) are the most insidious because they produce no error and no indication that the filter was dropped — the agent just gets wrong data with no warning.

---

## Root Cause Analysis

`listRoastsSchema` was designed as a thin DB wrapper for direct CLI use, where a human can inspect results. The LLM tool layer evolved independently with richer semantics. The gap was acknowledged in tools.ts comments but never fed back into the CLI schema — the same divergence pattern as catalog search before PR #53.

The `roast_profiles` view in Supabase already joins `green_coffee_inv` (which has `catalog_id` and `stocked` columns), so all the filter columns are queryable server-side. No new DB views or RPC calls are needed.

---

## Proposed Fix

### 1. Extend `listRoastsSchema` in `src/lib/roast.ts`

Add five new optional fields:

```typescript
export const listRoastsSchema = z.object({
  coffee_id: z.number().int().positive().optional(),
  catalog_id: z.number().int().positive().optional(), // NEW: filter by catalog_id
  roast_id: z.number().int().positive().optional(), // NEW: fetch a specific roast by id (returns array for API consistency)
  batch_name: z.string().optional(), // NEW: ilike filter on batch_name
  roast_date_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // NEW: YYYY-MM-DD
  roast_date_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(), // NEW: YYYY-MM-DD
  stocked_only: z.boolean().optional(), // NEW: filter to stocked beans only
  limit: z.number().int().min(1).default(20),
});
```

### 2. Update `listRoasts()` in `src/lib/roast.ts`

Apply new filters server-side in the Supabase query:

```typescript
if (parsed.catalog_id !== undefined) {
  query = query.eq('catalog_id', parsed.catalog_id);
}

if (parsed.roast_id !== undefined) {
  query = query.eq('roast_id', parsed.roast_id);
}

if (parsed.batch_name) {
  const safe = parsed.batch_name.replace(/[%_]/g, '\\$&');
  query = query.ilike('batch_name', `%${safe}%`);
}

if (parsed.roast_date_start) {
  query = query.gte('roast_date', parsed.roast_date_start);
}

if (parsed.roast_date_end) {
  query = query.lte('roast_date', parsed.roast_date_end);
}

if (parsed.stocked_only === true) {
  query = query.eq('stocked', true);
}
```

Note: `roast_profiles` is a view. Verify that `catalog_id`, `stocked`, and `batch_name` are exposed columns. Based on the `coffee_catalog!catalog_id` join pattern already used in `src/lib/roast.ts` (lines 203, 438), `catalog_id` is available.

### 3. Update `buildRoastCommand()` in `src/commands/roast.ts` — `list` subcommand

Add CLI flags:

```
--batch-name <text>    Filter by batch name (partial match, case-insensitive)
--date-start <YYYY-MM-DD>  Only show roasts on or after this date
--date-end <YYYY-MM-DD>    Only show roasts on or before this date
--stocked              Only show roasts for currently stocked beans
--catalog-id <id>      Filter by coffee_catalog ID (cross-reference from catalog search)
```

The `--stocked` flag aligns with the existing `inventory list --stocked` pattern (same behavior, same flag name).

### 4. Update `purvey roast list` help text and examples

Add examples:

```
purvey roast list --batch-name "Ethiopia Guji"
purvey roast list --date-start 2026-03-01 --date-end 2026-03-31
purvey roast list --stocked --limit 10
purvey roast list --catalog-id 128
```

### 5. Update `purvey context` in `src/commands/context.ts`

Add the new flags to the ROAST COMMANDS section's `roast list` entry.

### 6. Update `coffee-app tools.ts` (follow-up, separate PR)

After CLI publish:

- Pass `batch_name`, `roast_date_start`, `roast_date_end`, `stocked_only`, `catalog_id` through to CLI
- Remove client-side post-filter blocks for these fields
- Keep only `include_calculations` as chat-specific (no CLI equivalent)
- The `3× limit` hack can be reverted to `finalLimit` once server-side filters are trusted

---

## Files to Change

**purveyors-cli:**

- `src/lib/roast.ts` — extend schema + query logic
- `src/commands/roast.ts` — add flags to `list` subcommand
- `src/commands/context.ts` — update `roast list` option list
- `tests/roast-update.test.ts` or new `tests/roast-list.test.ts` — schema validation tests
- `package.json` — bump to v0.8.4 (patch)

**coffee-app (follow-up):**

- `src/lib/services/tools.ts` — wire new fields, remove client-side hacks, revert 3× limit

---

## Acceptance Criteria

1. `purvey roast list --batch-name "Ethiopia"` returns only roasts whose batch_name contains "Ethiopia" (server-side)
2. `purvey roast list --date-start 2026-03-01 --date-end 2026-03-31` returns only roasts in March 2026
3. `purvey roast list --stocked` returns only roasts for currently stocked inventory items
4. `purvey roast list --catalog-id 128` returns only roasts for beans with catalog_id = 128
5. `purvey roast list --date-start 2026-03-01` (no end) returns all roasts on or after that date
6. Invalid date format (`--date-start "march first"`) emits an error and exits 1
7. All new flags appear in `purvey roast list --help`
8. All new flags appear in `purvey context` output
9. Existing tests pass; new schema validation tests cover each new field
10. `roast_id` filter returns the correct single roast (or empty array for unknown ID)

---

## Test Plan

Add to `tests/roast-list.test.ts` (new file) or extend existing roast tests:

- Schema: `stocked_only` accepts `true`/`false`/`undefined`
- Schema: `roast_date_start` rejects non-date strings
- Schema: `roast_date_end` rejects non-date strings
- Schema: `batch_name` trims and passes through correctly
- Integration (mock supabase): assert `.ilike('batch_name', ...)` called when `batch_name` set
- Integration: assert `.gte('roast_date', ...)` called when `roast_date_start` set
- Integration: assert `.eq('stocked', true)` called when `stocked_only: true`
- Integration: assert `.eq('catalog_id', ...)` called when `catalog_id` set

---

## Risk Assessment

**Low.** All changes are additive:

- New schema fields are optional; no breaking change to existing callers
- `listRoasts()` only activates new branches when fields are provided
- The `stocked` and `catalog_id` columns are available on the `roast_profiles` view via the existing join (verified by `coffee_catalog!catalog_id` join pattern in the file)
- One gotcha: confirm `roast_profiles` view exposes `stocked` from the `green_coffee_inv` join. If not, a fallback is to join through inventory. Check the view definition before writing the query.

---

## Alternatives Considered

1. **Add only date range filters** (most common LLM query pattern) — misses `stocked_only` silent-ignore bug, which is the most correctness-impacting issue.
2. **Add all filters including `roast_id`** — `roast_id` is already handled by `roast get` (single-item fetch); adding it to list is redundant but harmless. Include for LLM tool parity.
3. **Fix tools.ts client-side logic instead** — misses the flywheel benefit; CLI stays weak for agent use.
4. **Also add sort options to `roast list`** — useful but scope creep. Currently always sorted by `roast_date DESC`. Add sort in a follow-up PR if needed.

The full set (all 5 fields) is the right call: the stocked_only silent-ignore is a data-correctness bug, the date range is the most commonly needed agent filter, and catalog_id completes the cross-reference chain from catalog search → roast history.

---

## Open Questions

1. Does the `roast_profiles` Supabase view expose `stocked` from `green_coffee_inv`? Check via `purvey roast list --pretty | jq '.[0] | keys'` to see what columns are returned. If missing, the workaround is a subquery join or a view update (minor scope expansion).
2. `roast_id` as a list filter: return `[]` for no match or throw? Consistent with catalog `--ids` behavior (returns empty array, not error). Recommend empty array.
3. Version bump: patch (0.8.4) appropriate; these are non-breaking additions.
