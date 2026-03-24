# Plan: Add Server-Side Filters for `name`, `supplier`, and `coffee_ids` to `catalog search`

**Date:** 2026-03-23
**Slug:** catalog-search-server-side-filters

---

## Problem Description

`purvey catalog search` currently supports `--origin`, `--process`, `--price-min/max`, `--flavor`, `--stocked`, `--sort`, `--offset`, `--limit`. But `coffee-app`'s `tools.ts` has the CLI in its dependency chain and its `coffee_catalog_search` tool supports 5 additional filter fields that `searchCatalog()` ignores — so the chat agent silently falls back to client-side filtering or drops them entirely:

| LLM Tool Field  | CLI Support | Behavior Today                                                             |
| --------------- | ----------- | -------------------------------------------------------------------------- |
| `name`          | None        | Client-side substring filter on results (misses items past the page limit) |
| `supplier`      | None        | Client-side filter on `source` field (same problem)                        |
| `coffee_ids`    | None        | Client-side ID set filter (only works within returned page)                |
| `drying_method` | None        | Client-side filter                                                         |
| `variety`       | None        | Heuristic client-side search on `cultivar_detail`                          |

The first three (`name`, `supplier`, `coffee_ids`) are the most impactful because they have exact, efficient server-side equivalents in Supabase. `name` and `supplier` are simple `ilike` filters. `coffee_ids` is an `in()` filter. All three reduce result set size and improve accuracy — particularly critical when agents issue `coffee_ids` lookups expecting deterministic single-row returns.

Fixing these in `searchCatalog()` removes the "silently ignored when the CLI has no equivalent" comment in tools.ts and allows the LLM tool schema to drop its client-side post-filter code, making the flywheel pattern actually work for these fields.

---

## Root Cause Analysis

`searchCatalogSchema` was built for human CLI users who think in terms of origin/process/price. The agent-facing LLM tool was designed separately and evolved additional fields without feeding them back into the CLI schema. No one tracked the divergence.

The `coffee_ids` case is especially problematic: an agent that resolves a specific coffee ID from a prior search, then passes it back to `coffee_catalog_search` for detail retrieval, will only get the correct result if the item happens to land in the first `--limit` results. With 1,258 catalog rows, this is not guaranteed.

---

## Proposed Fix

### 1. Update `searchCatalogSchema` in `src/lib/catalog.ts`

Add three new optional fields:

```typescript
export const searchCatalogSchema = z.object({
  // ... existing fields ...
  name: z.string().optional(), // Filter by coffee name (ilike)
  supplier: z.string().optional(), // Filter by source/supplier (ilike)
  ids: z.array(z.number().int().positive()).optional(), // Fetch specific IDs (bypasses other filters)
});
```

### 2. Update `searchCatalog()` in `src/lib/catalog.ts`

Add three query branches after existing filters:

```typescript
if (parsed.name) {
  const n = sanitizeFilterValue(parsed.name);
  query = query.ilike('name', `%${n}%`);
}

if (parsed.supplier) {
  const s = sanitizeFilterValue(parsed.supplier);
  query = query.ilike('source', `%${s}%`);
}

if (parsed.ids && parsed.ids.length > 0) {
  // ID lookup: return exactly these items, ignore limit/offset
  query = query.in('catalog_id', parsed.ids);
  // Note: do NOT apply .limit() when ids is set — return all requested IDs
}
```

The `ids` case should bypass the `limit` and `offset` logic because the caller is asking for specific known items — applying a page limit would silently truncate the response.

### 3. Update `buildCatalogCommand()` in `src/commands/catalog.ts`

Add CLI flags to the `search` subcommand:

```
--name <text>       Filter by coffee name (partial match, case-insensitive)
--supplier <name>   Filter by supplier/source name (partial match)
--ids <n,n,...>     Fetch specific catalog IDs (comma-separated, ignores limit)
```

Parsing for `--ids`: accept comma-separated string, split and parse to `number[]`. Emit a warning if any token is non-numeric.

### 4. Update help text and examples in `catalog search`

Add examples:

```
purvey catalog search --name "Guji" --pretty
purvey catalog search --supplier "Royal Coffee" --stocked --pretty
purvey catalog search --ids "1182,1183,1200"
```

### 5. Update `purvey context` in `src/commands/context.ts`

Update the CATALOG COMMANDS section to list all current options including `--name`, `--supplier`, `--ids`.

### 6. Update `tools.ts` client-side post-filters (coffee-app)

After CLI is bumped and published:

- Remove client-side `name`, `supplier`, `coffee_ids` post-filter blocks
- Pass `name` → `name`, `supplier` → `supplier`, `coffee_ids` → `ids` in `cliInput`
- Update comment from "silently ignored" to reflect proper CLI support

---

## Files to Change

**purveyors-cli:**

- `src/lib/catalog.ts` — schema + `searchCatalog()` logic
- `src/commands/catalog.ts` — add `--name`, `--supplier`, `--ids` flags + help text
- `src/commands/context.ts` — update catalog search option list
- `tests/catalog.test.ts` — add test cases for new filters
- `package.json` — bump to v0.8.3 (patch)

**coffee-app (follow-up, separate PR after CLI publish):**

- `src/lib/services/tools.ts` — remove client-side post-filters, wire new CLI fields

---

## Acceptance Criteria

1. `purvey catalog search --name "Ethiopia Guji"` returns only coffees with "Ethiopia Guji" in their name
2. `purvey catalog search --supplier "Royal Coffee" --stocked` returns only Royal Coffee items
3. `purvey catalog search --ids "1182,1183"` returns exactly those two items regardless of `--limit`
4. `purvey catalog search --name "foo" --origin "Ethiopia"` correctly combines both filters (AND)
5. `purvey catalog search --ids "9999999"` returns empty array (not an error)
6. Invalid `--ids` input (non-numeric token) emits a `warn()` and exits 1
7. All new filters appear in `purvey catalog search --help`
8. All new filters appear in `purvey context` output
9. Existing tests still pass; new tests cover each new filter path
10. No regressions to `--sort`, `--offset`, `--limit` behavior when `--ids` is NOT set

---

## Test Plan

Add to `tests/catalog.test.ts` (using `computeCatalogStats` / unit testing `searchCatalogSchema`):

- Schema validation: `ids` rejects non-integer values, rejects empty array, accepts valid array
- Schema validation: `name` trims/passes through correctly
- Integration test (mock supabase): assert `.ilike('name', ...)` called when `name` is set
- Integration test: assert `.in('catalog_id', [...])` called when `ids` is set, and `.limit()` is NOT called

---

## Risk Assessment

**Low.** All changes are additive:

- New schema fields are optional; no breaking change to existing CLI callers
- `searchCatalog()` is a pure filter function; new branches only activate when the new fields are provided
- The `ids` limit-bypass is the only subtle behavior; it's gated on `parsed.ids?.length > 0`
- coffee-app tools.ts change is a follow-up PR; the existing client-side filters remain as a safe fallback until CLI is published and bumped

**One gotcha:** The `coffee_catalog` table uses `catalog_id` as the PK (not `id`). The `CatalogItem` interface exposes it as `.id` via a Supabase alias. The Supabase query for `.in()` should use the raw column name `catalog_id`, not `id`. Verify against existing `getCatalog()` which uses `.eq('id', id)` — may need to confirm alias behavior.

---

## Alternatives Considered

1. **Add `--name` only (smallest possible PR)** — lower impact; leaves `supplier` and `ids` as client-side hacks.
2. **Add all 5 missing fields (`name`, `supplier`, `coffee_ids`, `drying_method`, `variety`)** — `drying_method` and `variety` are lower agent traffic and would bloat the schema. Scope them to a follow-up.
3. **Don't touch the CLI; improve client-side filters in tools.ts** — misses the flywheel benefit; agent accuracy doesn't improve for paginated result sets.

The three-field plan (`name`, `supplier`, `ids`) hits the highest agent-impact cases with minimal schema surface expansion.

---

## Open Questions

1. Does `catalog_id` have an alias to `id` in the Supabase select? Check `.eq('id', id)` in `getCatalog()` vs raw table schema.
2. Should `--ids` accept a JSON array string (`--ids '[1,2,3]'`) or only comma-separated? Comma-separated is more CLI-native; JSON is more agent-friendly. Recommend comma-separated with a note in `purvey context`.
3. Version bump: patch (0.8.3) is appropriate since these are non-breaking additions. Confirm no coffee-app minor bump required.
