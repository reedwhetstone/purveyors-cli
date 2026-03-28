# Plan: Add server-side filters for variety, drying_method, stocked_days to catalog search

## Problem

The `coffee_catalog_search` tool in `coffee-app/src/lib/services/tools.ts` applies three filters client-side after fetching results from the CLI:

- `variety` → matches `cultivar_detail` or `description_short` (line 130-135)
- `drying_method` → matches `drying_method` (line 125-127)
- `stocked_days` → computes date cutoff and filters on `stocked_date` (line 139-141)

These are client-side because the CLI's `searchCatalogSchema` (`src/lib/catalog.ts`) does not yet support them. This means:

- **Over-fetching**: the CLI fetches up to `--limit` rows then the chat agent discards most of them
- **Reduced effectiveness**: a 10-result limit on CLI may return 0 relevant coffees after client-side filtering
- **No flywheel**: the chat agent cannot offer these filters to users, only the hardcoded client-side behavior

The CLI already has `--name`, `--supplier`, `--ids` (PR #53, Mar 24) added as server-side filters following the same pattern. This plan continues that work.

## Root Cause

`searchCatalogSchema` in `src/lib/catalog.ts` was built incrementally. Initial filters (origin, process, price, flavor, stocked, sort, offset, limit, name, supplier, ids) were added as features were needed. The three remaining filters were never wired in, and remain client-side only in tools.ts.

## Evidence

**tools.ts lines 74-88** (schema input):

```
variety: z.string().optional()
stocked_days: z.number().optional()
drying_method: z.string().optional()
```

**tools.ts lines 125-141** (client-side filter code):

```
if (input.drying_method) { coffees = coffees.filter(...) }
if (input.variety) { coffees = coffees.filter(...) }
if (input.stocked_days) { cutoff = new Date(); cutoff.setDate(...); coffees = coffees.filter(...) }
```

**catalog.ts searchCatalogSchema** (lines 65-85): `variety`, `drying_method`, `stocked_days` are absent from the Zod schema.

**catalog.ts CatalogItem interface** (lines 14-15): Both `drying_method` and `cultivar_detail` already exist as fields.

**CatalogItem interface** (line 31): `stocked_date: string | null` exists for stocked_days computation.

## Proposed Fix

## Positioning Recommendation: separate "recently stocked" from "freshest"

These are **not the same question** and should not share one overloaded filter.

### Keep `stockedDays` tied to `stocked_date`

Use `stocked_date` for `stockedDays`. This answers:

- "What was stocked recently?"
- "Show me coffees added to inventory in the last 7 days"
- "What's newly available?"

This is the right default for an operational availability filter because it reflects when the coffee became selectable in Purveyors inventory.

### Do **not** use `stockedDays` to answer "freshest coffee"

When a user asks for the **freshest** coffee, they usually mean physical recency of the coffee landing or becoming newly available from the importer, which maps more naturally to `arrival_date`, not `stocked_date`.

If `stockedDays` silently switches between `stocked_date` and `arrival_date`, the semantics become muddy and hard to explain.

### Recommendation for MVP

For this plan:

- implement `stockedDays` using **`stocked_date` only**
- document it in help text as **"stocked within the last N days"**, not "freshest"
- leave freshness as a separate follow-up capability

### Recommended follow-up primitive

Add a separate freshness-oriented filter or sort in a later PR:

- **`arrivalDays`** → `arrival_date >= cutoff`
- and/or improve **`sort: newest`** to use `COALESCE(arrival_date, stocked_date, last_updated)` instead of just `last_updated`

That gives the agent a clean distinction:

- **recently stocked** → `stockedDays`
- **freshest arrivals** → `arrivalDays` or `sort: newest`

### Chat-agent routing recommendation

When users ask:

- **"newly stocked" / "recently added" / "stocked in the last week"** → use `stockedDays`
- **"freshest coffee" / "new arrivals" / "just landed"** → prefer `arrival_date` logic, not `stocked_date`

This avoids semantic drift and keeps the CLI explainable.

### 1. Update `searchCatalogSchema` in `src/lib/catalog.ts`

Add three new optional fields:

- `dryingMethod: z.string().optional()` — matches `coffee_catalog.drying_method` (ilike)
- `variety: z.string().optional()` — matches `coffee_catalog.cultivar_detail` (ilike, partial)
- `stockedDays: z.number().int().positive().optional()` — computes `stocked_date >= NOW() - INTERVAL 'n days'`

### 2. Update `searchCatalog()` function in `src/lib/catalog.ts`

Add three new query branches before the `if (parsed.stocked)` block:

```
if (parsed.dryingMethod) {
  const d = sanitizeFilterValue(parsed.dryingMethod);
  query = query.ilike('drying_method', `%${d}%`);
}
if (parsed.variety) {
  const v = sanitizeFilterValue(parsed.variety);
  query = query.or(`cultivar_detail.ilike.%${v}%,description_short.ilike.%${v}%`);
}
if (parsed.stockedDays !== undefined) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parsed.stockedDays);
  query = query.eq('stocked', true).gte('stocked_date', cutoff.toISOString().split('T')[0]);
}
```

Note: `stockedDays` implies `stocked=true` so it can reuse the existing `stocked` filter.

### 3. Add CLI options in `src/commands/catalog.ts`

In the `catalog search` command builder, add three new `.option()` calls alongside existing filters:

```
.option('--variety <text>', 'Filter by coffee variety/cultivar')
.option('--drying-method <method>', 'Filter by drying method (e.g. raised-bed, mechanical)')
.option('--stocked-days <n>', 'Only show coffees stocked within the last N days')
```

Update the searchCatalog call in the action handler to pass the new options.

Update help text examples section.

### 4. Add unit tests in `tests/catalog.test.ts`

```
describe('searchCatalogSchema — variety filter')
describe('searchCatalogSchema — dryingMethod filter')
describe('searchCatalogSchema — stockedDays filter')
```

## Files to Change

| File                      | Change                                                |
| ------------------------- | ----------------------------------------------------- |
| `src/lib/catalog.ts`      | Add 3 fields to schema, 3 branches to searchCatalog() |
| `src/commands/catalog.ts` | Add 3 CLI options, wire to searchCatalog call         |
| `tests/catalog.test.ts`   | Add schema + integration tests for new filters        |

## Acceptance Criteria

- [ ] `purvey catalog search --variety "Gesha"` returns only coffees matching that variety
- [ ] `purvey catalog search --drying-method "raised-bed"` returns only coffees with that drying method
- [ ] `purvey catalog search --stocked-days 7` returns only coffees stocked in the last 7 days
- [ ] `purvey catalog search --stocked-days 30 --origin "Ethiopia"` composes correctly (AND logic)
- [ ] New filters are listed in `purvey context` output
- [ ] New filters appear in README.md command reference
- [ ] All 14 existing test suites pass (2551 lines)
- [ ] `npm run test` exits 0

## Test Plan

1. **Schema unit tests**: parse valid/invalid values for each new field (variety string, dryingMethod string, stockedDays positive integer)
2. **Query integration**: mock Supabase to verify ilike/eq/gte calls are constructed correctly for each filter
3. **CLI smoke tests**: run `purvey catalog search --variety X`, `--drying-method Y`, `--stocked-days Z` against dev Supabase and verify results
4. **Composability**: `--stocked-days 7 --origin Ethiopia --pretty` produces expected combined filter

## Risk Assessment

- **Low risk**: additive filters only, no behavior changes to existing filters
- **No breaking changes**: new optional fields, all existing callers unaffected
- **Schema drift**: catalog table has `drying_method`, `cultivar_detail`, `stocked_date` columns confirmed in CatalogItem interface
- **Test coverage**: existing 304-line catalog test suite provides good regression coverage

## Alternative Considered: No-op

Continue client-side filtering. Drawback: chat agent cannot expose these filters to users, agents always over-fetch, and the 10-result default limit may return 0 useful coffees when variety/drying_method filters are applied.

## Implementation Order

1. Schema + lib/catalog.ts search logic (smallest scope, validates filter approach)
2. CLI options + catalog.ts command wiring
3. Tests
4. Update `purvey context` output (auto-generated from command definitions)
5. README.md update
