# Plan: Add Server-Side Filters to Sales List

**Date:** 2026-03-29 (America/Denver)
**Slug:** sales-list-server-side-filters

---

## Problem Description

`purvey sales list` only supports `--limit`. Users querying a large sales history have no way to filter by roast, date range, or buyer without fetching everything and piping through jq.

For agents, this means: "show sales from last month" requires fetching all sales and post-filtering. The coffee-app `sales_history` tool likely does the same client-side.

---

## Evidence

**Current CLI (src/commands/sales.ts):**

```
sales list [--limit <n>]
```

**Current lib schema (src/lib/sales.ts):**

```typescript
export const listSalesSchema = z.object({
  limit: z.number().int().min(1).default(20),
});
```

The Supabase query in `listSales()` has no `.eq()`, `.gte()`, `.lte()`, or `.ilike()` filters.

**Gap:** No way to filter by:

- `--roast-id` (which roast was sold)
- `--date-start` / `--date-end` (sell date range)
- `--buyer` (partial match on buyer name)

---

## Proposed Fix

### Files to change

**`src/lib/sales.ts`**:

Add three optional fields to `listSalesSchema`:

```typescript
export const listSalesSchema = z.object({
  limit: z.number().int().min(1).default(20),
  roastId: z.number().int().positive().optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  buyer: z.string().optional(),
});
```

Add filter blocks to `listSales()`:

```typescript
if (parsed.roastId) query = query.eq('roast_id', parsed.roastId);
if (parsed.dateStart) query = query.gte('sell_date', parsed.dateStart);
if (parsed.dateEnd) query = query.lte('sell_date', parsed.dateEnd);
if (parsed.buyer) {
  const safe = sanitizeFilterValue(parsed.buyer); // reuse from catalog.ts
  query = query.ilike('buyer', `%${safe}%`);
}
```

**`src/commands/sales.ts`**:

Add four options to `sales list`:

```
--roast-id <id>           Filter by roast profile ID
--date-start <YYYY-MM-DD> Only show sales on or after this date
--date-end <YYYY-MM-DD>   Only show sales on or before this date
--buyer <name>            Filter by buyer name (partial match)
```

**`src/commands/context.ts`**:

Update the sales list section:

```
sales (member)
  list
    --roast-id <roast_id>
    --date-start <YYYY-MM-DD>
    --date-end <YYYY-MM-DD>
    --buyer <name>
    --limit <n>
```

**`tests/sales.test.ts`**:

Add schema tests for all four new fields.

---

## Acceptance Criteria

1. `purvey sales list --roast-id 42` returns only sales for roast 42
2. `purvey sales list --date-start 2026-03-01 --date-end 2026-03-31` returns only March sales
3. `purvey sales list --buyer "Jane"` returns sales with "jane" in buyer field
4. Filters compose (e.g. `--roast-id 42 --date-start 2026-01-01`)
5. `purvey context` output includes all four new flags
6. Unit tests pass for schema validation

---

## Risk Assessment

Low risk. Pure additive change. Same pattern as roast list date filters (PR #55).
No auth changes, no writes, no migrations.

---

## Version Bump

Patch: `0.9.0 → 0.9.1` (additive filter, no breaking change).
Coffee-app dep (`^0.9.0`) auto-resolves — no bump needed.
