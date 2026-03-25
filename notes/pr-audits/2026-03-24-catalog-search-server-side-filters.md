# PR Verification Report

## Metadata

- **Repo:** purveyors-cli
- **Base:** origin/main (7839ea8)
- **Head:** feat/catalog-search-server-side-filters (6ceb265)
- **PR:** #53
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** 6 files changed, 302 insertions, 7 deletions. Focused addition of three server-side filters. Fully reviewable in a single pass.

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 0, P1: 2, P2: 3, P3: 2

## Intent Verification

- **Stated intent:** Add `--name`, `--supplier`, `--ids` server-side filters to `purvey catalog search` so agent and human workflows get accurate results instead of relying on client-side post-filtering that misses items beyond the page limit.
- **What was implemented:** All three filters added to: Zod schema (`searchCatalogSchema`), query builder (`searchCatalog()`), CLI flag parser (`buildCatalogCommand()`), context reference (`buildContextCommand()`), help text, and unit tests. The `--ids` filter correctly bypasses `limit`/`offset` pagination. Version bumped to 0.8.3 (patch). Implementation plan doc included.
- **Coverage gaps:** None for the stated three-filter scope. The plan explicitly defers `drying_method` and `variety` to a follow-up, which is sensible.

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

- **P1-1: `catalog_id` vs `id` column name inconsistency is a latent correctness risk**
  - **Evidence:** `searchCatalog()` in `src/lib/catalog.ts:222` uses `.in('catalog_id', parsed.ids)`, while `getCatalog()` at line 271 uses `.eq('id', id)`. The `CatalogItem` interface declares `id: number` (line 7), and the `getCatalogStats()` function at line 282 uses `.select('id, ...')`. The `catalog similar` command in `src/commands/catalog.ts:232` uses `.eq('catalog_id', coffeeId)`.
  - **Impact:** This PR uses `catalog_id` for the `.in()` filter, which is correct per the raw table schema (the plan doc explicitly calls this out as a gotcha). However, `getCatalog()` uses `.eq('id', id)` on the same table. If Supabase has a column alias mapping `id` to `catalog_id`, both work. If not, one of these two call patterns is wrong. The PR plan's "Open Questions" section (#1) flags this exact issue but doesn't resolve it. Since `.in('catalog_id', ...)` matches the raw column name and is consistent with `catalog similar`, this PR is likely correct, but `getCatalog()` may be the buggy one.
  - **Correction:** Verify which column name Supabase actually resolves. If `catalog_id` is the real column, the PR is correct and `getCatalog()` should be fixed in a follow-up (out of scope for this PR, but should be filed). If Supabase aliases `id` to `catalog_id`, then both work and no action needed. **At minimum, add a code comment at line 222 explaining why `catalog_id` is used here vs `id` elsewhere.**

- **P1-2: No maximum bound on `--ids` array size**
  - **Evidence:** `src/commands/catalog.ts:93-105` parses `--ids` from comma-separated input with no upper limit. The Zod schema at `src/lib/catalog.ts:78` validates `z.array(z.number().int().positive())` with no `.max()`. Supabase `.in()` translates to a SQL `WHERE catalog_id IN (...)` clause.
  - **Impact:** An agent or user passing hundreds or thousands of IDs could generate an excessively long query URL (Supabase REST API uses query params, subject to URL length limits, typically 8KB). With IDs averaging 4-5 digits, ~1000 IDs would push close to or exceed that limit, resulting in a cryptic HTTP 414 or a Supabase error. This is more likely in agent workflows where an LLM might construct large ID lists programmatically.
  - **Correction:** Add `.max(100)` (or similar reasonable cap) to the Zod schema's `ids` field: `z.array(z.number().int().positive()).max(100).optional()`. Add a corresponding CLI-side check or let Zod validation surface the error. This prevents the silent failure mode.

### P2 (important improvements)

- **P2-1: Empty string `--ids ""` produces a silent query with `parsed.ids` as `undefined` but the parsing code still runs**
  - **Evidence:** In `src/commands/catalog.ts:95`, if `opts.ids` is the empty string `""`, it evaluates to truthy (empty string is falsy in JS... actually `""` is falsy). Wait, Commander would pass the string value, so `--ids ""` would yield `opts.ids = ""`, which is falsy. But `--ids " "` would be truthy. Then `" ".split(',')` yields `[" "]`, `" ".trim()` yields `""`, and `parseInt("", 10)` yields `NaN`, triggering the error path. So this edge case is actually handled. However, `--ids ","` yields `["", ""]` after split, both trimmed to `""`, both `NaN`, caught. This is fine.
  - **Revised finding: `--ids` with trailing comma** (e.g., `--ids "1,2,"`) produces `["1", "2", ""]`, and the empty string token triggers `parseInt("", 10) = NaN`, exiting with an error. This is technically correct behavior but the error message `Invalid --ids value: ""` is confusing.
  - **Correction:** Trim empty tokens after split: `const raw = (opts.ids as string).split(',').map(s => s.trim()).filter(Boolean);` This gracefully handles trailing commas, which are a common copy-paste artifact.

- **P2-2: `--ids` combined with other filters could return unexpected empty results without guidance**
  - **Evidence:** If a user passes `--ids "1182" --origin "Colombia"` but ID 1182 is from Ethiopia, they get zero results because both filters are AND-composed at the Supabase level. The plan doc mentions this in acceptance criterion #4 ("correctly combines both filters (AND)"), so this is intentional. However, neither the help text nor `purvey context` warns users about this interaction.
  - **Impact:** Low for human users (intuitive AND behavior). Moderate for agents, which might combine `--ids` with `--stocked` or `--origin` without understanding the AND semantics, silently getting empty results.
  - **Correction:** Add a brief note in help text: `--ids combined with other filters returns only items matching ALL criteria.` Consider whether the plan's intent for `--ids` ("return exactly these items") implies it should bypass other filters too, not just `limit`/`offset`. The current AND behavior is defensible, but worth a conscious product decision.

- **P2-3: Missing integration tests for the actual Supabase query builder**
  - **Evidence:** All tests in `tests/catalog.test.ts` are schema validation and `sanitizeFilterValue` unit tests. No test mocks the Supabase client to verify that `.ilike('name', ...)`, `.ilike('source', ...)`, or `.in('catalog_id', ...)` are actually called with the correct arguments. No test verifies the `limit`/`offset` bypass when `ids` is present.
  - **Impact:** The core behavioral changes (the actual query building in `searchCatalog()`) are untested. Schema validation catches type errors but not logic bugs like querying the wrong column name, forgetting to apply a filter, or incorrect limit bypass logic.
  - **Correction:** Add mock-based integration tests that: (1) verify `.ilike('name', '%Guji%')` is called when `name` is passed, (2) verify `.in('catalog_id', [1,2])` is called when `ids` is passed, (3) verify `.limit()` is NOT called when `ids` is present, (4) verify `.limit()` IS called when `ids` is absent. This matches the plan doc's test plan section ("Integration test (mock supabase)") which was explicitly called for but not implemented.

### P3 (nice to have)

- **P3-1: Schema field ordering puts new fields after `limit`**
  - **Evidence:** In `src/lib/catalog.ts:75-78`, the new `name`, `supplier`, `ids` fields are appended after `limit`. Convention in the existing schema groups filter fields together and puts pagination (`offset`, `limit`) last.
  - **Impact:** Cosmetic only. No functional impact.
  - **Correction:** Move `name`, `supplier`, `ids` above `offset`/`limit` in the schema definition for readability.

- **P3-2: Implementation plan included in PR**
  - **Evidence:** `notes/implementation-plans/2026-03-23-catalog-search-server-side-filters.md` is a 178-line planning doc committed with the feature.
  - **Impact:** This is actually positive for documentation. Just noting it for completeness. It could live in the PR description instead, but having it in-repo is fine for this project's conventions.

## Assumptions Review

| Assumption | Validity | Rationale | Action |
|---|---|---|---|
| `catalog_id` is the correct raw column name for `.in()` | Likely Valid | `catalog similar` command uses `.eq('catalog_id', coffeeId)` on the same table; inventory joins reference `catalog_id` | Verify once, add comment |
| `ilike` on `name` column works for partial matching | Valid | Same pattern used for `origin` (`.ilike` on `country`, `region`) | None |
| `source` is the correct column for supplier | Valid | `CatalogItem.source` is typed `string | null`, and `catalog similar` displays `targetBean.source` as the supplier name | None |
| Sanitization via `sanitizeFilterValue` is sufficient for `ilike` inputs | Valid | Strips `(),.%*` which are the PostgREST special chars; the `%` wildcards are added programmatically, not from user input | None |
| Patch version bump (0.8.2 -> 0.8.3) is appropriate | Valid | Purely additive, no breaking changes to existing callers | None |
| `ids` bypass of `limit`/`offset` won't return unbounded result sets | Weak | Without a `.max()` on the array, a large IDs array returns all matching rows. Supabase default row limit is 1000, but that's a server config, not a guaranteed cap | Add `.max(100)` to schema |

## Tech Debt Notes

- **Debt introduced:** None significant. The code follows existing patterns cleanly.
- **Debt worsened:** The `id` vs `catalog_id` inconsistency in `getCatalog()` (line 271) is now more visible because the new code correctly uses `catalog_id`. This inconsistency predates this PR but the divergence is now clearer and should be resolved.
- **Suggested follow-up tickets:**
  1. Audit all `coffee_catalog` queries: normalize `id` vs `catalog_id` usage across `getCatalog()`, `getCatalogStats()`, and related functions
  2. Add mock-based integration tests for `searchCatalog()` query building (the plan doc called for this)
  3. Wire `name`/`supplier`/`ids` through to coffee-app's `tools.ts` and remove client-side post-filters (explicitly noted in plan as follow-up PR)

## Product Alignment Notes

- **Alignment wins:** Directly addresses the agent accuracy problem described in the plan. The three filters chosen (`name`, `supplier`, `ids`) are the highest-impact server-side equivalents for the chat agent's most common query patterns. The `ids` limit bypass is a correct product decision: when an agent asks for specific known items, truncating by page limit is wrong.
- **Misalignments:** None identified.
- **Suggested product checks:** Verify that `coffee-app`'s `tools.ts` correctly maps `coffee_ids` (its field name) to `ids` (CLI field name) in the follow-up PR. The naming difference (`coffee_ids` vs `ids`) is minor but could cause a wiring mistake.

## Test Coverage Assessment

- **Existing tests that validate changes:**
  - Schema validation: `name`, `supplier`, `ids` parsing, rejection of invalid types, combination with existing fields (7 new tests)
  - `sanitizeFilterValue`: stripping PostgREST special characters (2 new tests)
  - All 25 tests pass
- **Missing tests:**
  - Integration tests mocking Supabase client to verify actual query construction (`.ilike('name', ...)`, `.in('catalog_id', ...)`)
  - Integration test verifying `limit`/`offset` bypass when `ids` is present
  - Integration test verifying `limit`/`offset` is applied when `ids` is absent
  - Edge case: `ids` as empty array `[]` (schema allows it; query path skips it via `length > 0` check, but no test confirms)
  - CLI parsing: `--ids "1,2,3"` string to `number[]` conversion (tested implicitly via schema, but not the Commander parsing layer)
- **Suggested test additions:** The plan doc's test plan section explicitly specified mock-based integration tests. These should be added before or shortly after merge.

## Minimal Correction Plan

1. **Add `.max(100)` to `ids` schema** in `src/lib/catalog.ts:78`: `z.array(z.number().int().positive()).max(100).optional()` (prevents unbounded query URL; P1-2)
2. **Filter empty tokens in `--ids` parsing** in `src/commands/catalog.ts:95`: add `.filter(Boolean)` after `.map(s => s.trim())` to handle trailing commas gracefully (P2-1)
3. **Add code comment explaining `catalog_id` usage** at `src/lib/catalog.ts:222` to document why `catalog_id` is used here vs `id` in `getCatalog()` (P1-1, documentation fix; the actual column name resolution should be verified separately)

## Optional Patch Guidance

### `src/lib/catalog.ts`

Line 78: Change `ids` schema to include max:
```typescript
ids: z.array(z.number().int().positive()).max(100).optional(),
```

Line 221-222: Add explanatory comment:
```typescript
if (parsed.ids && parsed.ids.length > 0) {
  // Use raw column name 'catalog_id' (not the Supabase alias 'id' used in getCatalog)
  query = query.in('catalog_id', parsed.ids);
}
```

### `src/commands/catalog.ts`

Line 95: Filter empty tokens:
```typescript
const raw = (opts.ids as string).split(',').map((s) => s.trim()).filter(Boolean);
```

### `src/lib/catalog.ts` (schema ordering, P3-1)

Move `name`, `supplier`, `ids` before `stocked`:
```typescript
export const searchCatalogSchema = z.object({
  origin: z.string().optional(),
  process: z.string().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  flavor: z.string().optional(),
  name: z.string().optional(),
  supplier: z.string().optional(),
  ids: z.array(z.number().int().positive()).max(100).optional(),
  stocked: z.boolean().optional(),
  sort: z.enum(catalogSortFields).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(10),
});
```
