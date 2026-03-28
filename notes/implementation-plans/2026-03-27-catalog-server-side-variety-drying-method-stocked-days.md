# Plan: Add Server-Side Filters for variety, drying_method, stocked_days to Catalog Search

**Date:** 2026-03-27 (America/Denver)
**Slug:** catalog-server-side-variety-drying-method-stocked-days

---

## Problem Description

Three `coffee_catalog_search` tool filters in `coffee-app/src/lib/services/tools.ts` are applied client-side after the CLI returns results:

- `variety` — partial match on `cultivar_detail` or `description_short` (tools.ts line ~130)
- `drying_method` — partial match on `drying_method` (tools.ts line ~125)
- `stocked_days` — date cutoff on `stocked_date` (tools.ts line ~139)

Because the CLI's `searchCatalogSchema` does not support these fields, the chat agent workaround is:

```typescript
// fetch more to allow for client-side filtering
limit: Math.min(input.limit ?? 10, 15);
```

The agent requests up to 15 rows, applies client-side filters, and returns the trimmed set. If a user asks "show me washed Ethiopians with fruit-forward notes, sun-dried only" and there are 50 stocked beans from Ethiopia, the CLI fetches the first 15 and the agent discards most of them. The truly matching beans may never appear.

---

## Root Cause

`searchCatalogSchema` in `src/lib/catalog.ts` was built incrementally. Initial launch filters and three later additions (name, supplier, ids — PR #53) cover most cases. The three remaining filters require less obvious DB patterns:

- `variety` → `ilike` on `cultivar_detail` (a defined column)
- `drying_method` → `ilike` on `drying_method` (a defined column)
- `stocked_days` → a computed date comparison `stocked_date >= (now() - interval)` using `.gte()` with a dynamically computed ISO date string

None of these are architecturally hard. They follow the exact same pattern as `origin` and `process`.

---

## Evidence

**Source 1: tools.ts client-side filter block (coffee-app)**

```typescript
// tools.ts ~line 125-141
if (input.drying_method) {
  const dryingLower = input.drying_method.toLowerCase();
  coffees = coffees.filter((c) => c.drying_method?.toLowerCase().includes(dryingLower));
}
if (input.variety) {
  const varietyLower = input.variety.toLowerCase();
  coffees = coffees.filter(
    (c) =>
      c.cultivar_detail?.toLowerCase().includes(varietyLower) ||
      c.description_short?.toLowerCase().includes(varietyLower)
  );
}
if (input.stocked_days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - input.stocked_days);
  coffees = coffees.filter((c) => {
    if (!c.stocked_date) return false;
    return new Date(c.stocked_date) >= cutoff;
  });
}
```

**Source 2: searchCatalogSchema (purveyors-cli/src/lib/catalog.ts line 66)**

```typescript
export const searchCatalogSchema = z.object({
  origin: z.string().optional(),
  process: z.string().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  flavor: z.string().optional(),
  stocked: z.boolean().optional(),
  sort: z.enum(catalogSortFields).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(10),
  name: z.string().optional(),
  supplier: z.string().optional(),
  ids: z.array(z.number().int().positive()).max(100).optional(),
  // variety, dryingMethod, stockedDays NOT present
});
```

**Source 3: CatalogItem type (catalog.ts line 14-15)** already includes both columns:

```typescript
drying_method: string | null;
cultivar_detail: string | null;
```

So the data is already returned; only the query-time filter is missing.

**Pattern precedent (PR #53):** `name`, `supplier`, and `ids` were all added in <50 lines total. This work follows the same playbook exactly.

---

## Proposed Fix

### Files to change

**`purveyors-cli/src/lib/catalog.ts`** (primary change):

1. Add three fields to `searchCatalogSchema`:

   ```typescript
   variety: z.string().optional(),        // filter on cultivar_detail
   dryingMethod: z.string().optional(),   // filter on drying_method
   stockedDays: z.number().int().positive().optional(),  // stocked within N days
   ```

2. Add query filter blocks to `searchCatalog()` after the existing filters:

   ```typescript
   if (parsed.variety) {
     const safe = sanitizeFilterValue(parsed.variety);
     query = query.ilike('cultivar_detail', `%${safe}%`);
   }

   if (parsed.dryingMethod) {
     const safe = sanitizeFilterValue(parsed.dryingMethod);
     query = query.ilike('drying_method', `%${safe}%`);
   }

   if (parsed.stockedDays) {
     const cutoff = new Date();
     cutoff.setDate(cutoff.getDate() - parsed.stockedDays);
     query = query.gte('stocked_date', cutoff.toISOString().slice(0, 10));
   }
   ```

**`purveyors-cli/src/commands/catalog.ts`** (expose via CLI):

Add three options to `catalog search`:

```
--variety <text>        Filter by coffee variety/cultivar (partial match)
--drying-method <text>  Filter by drying method (partial match)
--stocked-days <n>      Only show coffees stocked within N days
```

Update the command help text and examples.

**`purveyors-cli/src/commands/context.ts`** (agent onboarding):

Add the three new flags to the catalog search block in `CONTEXT_TEXT`.

**`coffee-app/src/lib/services/tools.ts`** (remove client-side workarounds):

Map the three new CLI fields and remove the three client-side filter blocks. Mirror the pattern used for name/supplier/ids in the PR #53 follow-on (coffee-app PR #167).

**`purveyors-cli/tests/catalog.test.ts`** (schema tests):

Add unit tests for:

- `variety` accepted as string
- `dryingMethod` accepted as string
- `stockedDays` accepted as positive integer
- `stockedDays` rejects 0 and negative
- `stockedDays` rejects non-integer

---

## Acceptance Criteria

1. `purvey catalog search --variety "gesha" --pretty` returns only beans with "gesha" in `cultivar_detail`
2. `purvey catalog search --drying-method "sun" --stocked --pretty` returns only sun-dried stocked beans
3. `purvey catalog search --stocked-days 30 --pretty` returns only beans stocked within the last 30 days
4. All three flags compose with existing flags (e.g. `--origin "Ethiopia" --variety "heirloom" --stocked`)
5. `purvey context` output includes all three new flags
6. coffee-app `coffee_catalog_search` tool removes the three client-side filter blocks; limits revert from `limit * 1` to `limit` without the `limitFactor * 3` workaround
7. Unit tests for all three schema additions pass

---

## Test Plan

**Unit tests** (no network):

- Schema validation for all three new fields (valid + reject cases)
- Confirm sanitizeFilterValue is applied (existing helper, same pattern as name/supplier)

**Manual smoke test**:

```bash
purvey catalog search --variety "gesha" --limit 5 --pretty
purvey catalog search --drying-method "raised bed" --stocked --limit 5 --pretty
purvey catalog search --stocked-days 14 --limit 10 --pretty
purvey catalog search --origin "Ethiopia" --variety "heirloom" --drying-method "sun" --stocked --limit 10
```

**Context check**:

```bash
purvey context | grep -A5 "variety\|drying\|stocked-days"
```

---

## Risk Assessment

**Low risk.** This is a pure additive change:

- New optional fields in an existing Zod schema (no breaking changes)
- New `.ilike()` and `.gte()` query clauses that only activate when the flag is passed
- Follows the exact same pattern as `name`, `supplier`, `ids` (already shipped and tested in PR #53/#56)
- Client-side removal in tools.ts is safe because server-side output is a superset (same results, just server-filtered)

No auth changes, no writes, no new dependencies, no schema migrations.

---

## Open Questions

1. Should `variety` also search `description_short` on the server side (as the current client-side code does) or only `cultivar_detail`? Searching both requires a PostgREST `.or()` query. Recommend `cultivar_detail`-only for now (cleaner, matches the column semantic), with a fast-follow if users want broader matching.

2. `stocked_days` is calculated at query time in the CLI. If the CLI is used as a library (coffee-app imports it), the cutoff date is computed at call time — this is correct behavior. No issue.

3. Version bump: these are additive feature additions → minor version bump (0.8.x → 0.9.0) per semver. Coffee-app dep specifier `^0.8.x` would need updating to `^0.9.0` after publish.

---

## Implementation Complexity

Estimated ~80-100 lines across all files. 4-5 files touched. 1 PR, no back-end DB changes. Straightforward.

**Precedent PRs:** #53 (name/supplier/ids), #56 (catalog filter audit fixes) — both merged cleanly.
