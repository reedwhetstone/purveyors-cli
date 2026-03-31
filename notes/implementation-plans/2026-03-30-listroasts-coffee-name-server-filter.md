# Plan: Add `coffee_name` Server-Side Filter to `listRoasts`

**Date:** 2026-03-30
**Slug:** listroasts-coffee-name-server-filter
**Priority:** High — eliminates client-side workaround in coffee-app tools.ts

---

## Problem Description

`listRoastsSchema` currently has no `coffee_name` filter parameter. The `coffee_name` column is a denormalized string stored on `roast_profiles` rows (set at creation time from the catalog bean name).

coffee-app's `tools.ts` `roast_profiles` tool needs to search by bean name (e.g., "Find my Ethiopia Yirgacheffe roasts"). It passes `roast_name` to `listRoasts()`, but since the CLI has no server-side support, `tools.ts` works around it by:

1. Over-fetching: `limit: finalLimit * 3` (fetches 3× the requested records)
2. Client-side filtering `coffee_name` with `.toLowerCase().includes(nameLower)`
3. Then slicing to the requested limit

This is fragile: if a user has many matching roasts, the over-fetch multiplier may still miss records. It also wastes API quota and is inconsistent with all other filters that are properly server-side.

**Evidence (tools.ts:251-280):**

```typescript
// CLI listRoasts supports these filters server-side; roast_name and date range
// are applied client-side after fetching.
let profiles: RoastProfile[] = await listRoasts(supabase, userId, {
  ...
  limit: finalLimit * 3 // fetch more to allow for client-side filtering
});

// Client-side post-filters for params the CLI doesn't support server-side
if (input.roast_name) {
  const nameLower = input.roast_name.toLowerCase();
  profiles = profiles.filter((p) => p.coffee_name?.toLowerCase().includes(nameLower));
}
```

Note: `date_start` / `date_end` are also commented as "client-side after fetching" but they ARE actually in `listRoastsSchema` already. Only `coffee_name` is truly missing from the CLI.

---

## Root Cause

`listRoastsSchema` was built incrementally. Batch name filtering was added early (PR #57), but `coffee_name` was not included because it's a denormalized field — not a primary filter key — so it was deferred. coffee-app implemented its own workaround rather than filing the gap.

---

## Proposed Fix

### 1. `src/lib/roast.ts` — Add `coffee_name` to `listRoastsSchema`

```typescript
export const listRoastsSchema = z.object({
  // ... existing fields ...
  coffee_name: z
    .string()
    .optional()
    .describe('Filter by bean name (partial match, case-insensitive)'),
  // ...
});
```

### 2. `src/lib/roast.ts` — Add server-side filter in `listRoasts()`

In the query building section, after the `batch_name` filter:

```typescript
if (parsed.coffee_name) {
  const safe = sanitizeFilterValue(parsed.coffee_name);
  query = query.ilike('coffee_name', `%${safe}%`);
}
```

The `coffee_name` column is already in both `ROAST_LIST_SELECT` and `ROAST_DETAIL_SELECT` strings, so no select changes are needed.

### 3. `src/commands/roast.ts` — Expose as `--coffee-name` CLI flag

In the `roast list` command, add:

```typescript
.option('--coffee-name <text>', 'Filter by bean name (partial match, case-insensitive)')
```

And wire it in the action handler alongside the other parsed opts.

### 4. `src/lib/context.ts` — Update agent reference

Add `--coffee-name <text>` to the `roast list` section.

### 5. Version bump

Patch release: bump to `0.9.2` in `package.json`.

---

## Acceptance Criteria

- [ ] `purvey roast list --coffee-name "Ethiopia" --pretty` returns only roasts where `coffee_name` contains "Ethiopia" (case-insensitive)
- [ ] `purvey roast list --coffee-name "nonexistent" --pretty` returns an empty array `[]`, not an error
- [ ] `listRoasts(supabase, userId, { coffee_name: "guji" })` makes a single Supabase call with `ilike` (no over-fetch)
- [ ] `--coffee-name` appears in `purvey roast list --help` output
- [ ] `--coffee-name` appears in `purvey context` output under `roast list`
- [ ] Existing `--batch-name` filter unchanged and still passes tests
- [ ] coffee-app `tools.ts` can be updated to pass `coffee_name` instead of client-side filtering (out of scope for this PR, but the hook should work)

---

## Test Plan

No existing test exercises `coffee_name` filtering. Add to `src/lib/__tests__/roast.test.ts` (or create if absent):

1. Mock a Supabase client that captures the query builder calls
2. Assert that `listRoasts(client, userId, { coffee_name: "Ethiopia" })` produces an `ilike('coffee_name', '%Ethiopia%')` call
3. Assert that `listRoasts(client, userId, {})` (no `coffee_name`) does NOT add that filter
4. Test case-insensitive behavior by verifying the `ilike` pattern (database handles case; test that we pass the right SQL pattern)

---

## Files to Change

| File                       | Change                                           |
| -------------------------- | ------------------------------------------------ |
| `src/lib/roast.ts`         | Add `coffee_name` to schema + query building     |
| `src/commands/roast.ts`    | Add `--coffee-name` CLI flag + wire to lib       |
| `src/lib/context.ts`       | Add `--coffee-name <text>` to roast list section |
| `package.json`             | Bump to `0.9.2`                                  |
| `CHANGELOG.md` (if exists) | Note feature addition                            |

---

## Risk Assessment

**Low risk.**

- `coffee_name` is a plain string column on `roast_profiles`; `ilike` is safe and indexed-friendly
- No schema changes; additive only
- Follows the exact same pattern as `batch_name` filtering (already in production and working)
- No breaking changes to existing consumers; `coffee_name` is optional and defaults to undefined

---

## Alternatives Considered

1. **Continue with client-side workaround in coffee-app** — fragile, wastes quota, risks missing records when users have many roasts. Rejected.
2. **Add `coffee_name` as a join filter through `green_coffee_inv`** — unnecessary; `coffee_name` is already denormalized onto `roast_profiles`. Direct `ilike` is simpler and faster.
3. **Add full-text search across both `batch_name` and `coffee_name`** — broader scope, higher risk. Defer; a single `coffee_name` filter solves the immediate gap.

---

## Open Questions

None. This is a straightforward additive filter following the existing `batch_name` pattern.
