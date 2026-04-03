# inventory delete: Actionable FK Error + Dependency Pre-check

**Date:** 2026-04-02
**Slug:** inventory-delete-dependency-check
**Priority:** High
**Complexity:** Low-Medium
**Risk:** Low

---

## Problem Description

`purvey inventory delete <id>` silently propagates a raw PostgreSQL FK violation when the inventory item has dependent roast profiles or sales records. The user sees something like:

```
✖ update or delete on table "green_coffee_inv" violates foreign key constraint
  "roast_profiles_coffee_id_fkey" on table "roast_profiles"
```

This is the CLI surface of **DEVLOG Priority 1**: "Cannot delete a bean from green coffee inventory if it references a sales row or roast profile." The error is opaque, provides no path forward, and forces the user to manually understand Postgres FK semantics to figure out what to delete first.

---

## Root Cause

The schema has **no ON DELETE CASCADE** on the FK relationships:

- `roast_profiles.coffee_id → green_coffee_inv.id`
- `sales.green_coffee_inv_id → green_coffee_inv.id`

`deleteInventory()` in `src/lib/inventory.ts` does:

```ts
if (deleteError) throw deleteError;
```

No FK detection, no pre-check, no recovery hint.

---

## Proposed Fix

### 1. Pre-flight dependency check in `deleteInventory()` (lib layer)

Before issuing the DELETE, query for blocking dependencies:

```ts
const { count: roastCount } = await supabase
  .from('roast_profiles')
  .select('roast_id', { count: 'exact', head: true })
  .eq('coffee_id', id)
  .eq('user', userId);

const { count: salesCount } = await supabase
  .from('sales')
  .select('id', { count: 'exact', head: true })
  .eq('green_coffee_inv_id', id)
  .eq('user', userId);

if ((roastCount ?? 0) > 0 || (salesCount ?? 0) > 0) {
  const parts = [];
  if (roastCount) parts.push(`${roastCount} roast profile${roastCount === 1 ? '' : 's'}`);
  if (salesCount) parts.push(`${salesCount} sale record${salesCount === 1 ? '' : 's'}`);
  throw new PrvrsError(
    'DEPENDENCY_CONFLICT',
    `Cannot delete inventory item ${id} — it has ${parts.join(' and ')}. ` +
      `Delete them first, or use --force to cascade delete all dependent records.`
  );
}
```

### 2. `--force` flag on `inventory delete` command (command layer)

Add `--force` / `-f` to `src/commands/inventory.ts` inventory delete. When passed, the lib function performs:

1. Delete all sales referencing this inventory item (user-scoped)
2. Delete all roast profiles referencing this inventory item (user-scoped)
3. Delete the inventory item itself

Show a summary before the delete when not `--yes`:

```
This will also delete:
  • 3 roast profiles
  • 2 sale records
Proceed? [y/N]
```

### 3. Update `deleteInventory()` signature

Add an optional `opts` parameter:

```ts
export async function deleteInventory(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  opts?: { force?: boolean }
): Promise<{ deletedRoasts: number; deletedSales: number }>;
```

The return value gives the caller (and CLI output) confirmation of what was removed.

---

## Files to Change

| File                        | Change                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| `src/lib/inventory.ts`      | Add pre-flight check, `force` cascade path, update `deleteInventory` return type |
| `src/commands/inventory.ts` | Add `--force` flag, update confirmation prompt to show dependencies              |
| `src/commands/context.ts`   | Add `--force` to the `inventory delete` section in the agent reference doc       |

---

## Acceptance Criteria

- [ ] `purvey inventory delete <id>` on an item with dependencies emits a clear error listing the counts and explicitly tells the user to delete them first or use `--force`
- [ ] `purvey inventory delete <id> --force` cascades: deletes sales, then roasts, then the inventory item in one atomic sequence (same userId scoping throughout)
- [ ] `purvey inventory delete <id> --force --yes` skips the confirmation prompt entirely (non-interactive / agent usage)
- [ ] `purvey inventory delete <id>` on an item with NO dependencies still works exactly as before (no regression)
- [ ] `--force` output (JSON mode) includes `{ deletedRoasts: N, deletedSales: N, deletedInventoryId: id }`
- [ ] Error code `DEPENDENCY_CONFLICT` is returned in JSON error output (consistent with `PrvrsError` pattern)
- [ ] `purvey context` updated to document `--force` flag

---

## Test Plan

Extend `tests/write-commands.test.ts` or create `tests/inventory-delete.test.ts`:

1. Mock `supabase.from('roast_profiles').select()` to return count=2 → expect `PrvrsError` with code `DEPENDENCY_CONFLICT` and message containing "2 roast profiles"
2. Mock count=0 for both → expect delete to proceed (no error)
3. Test `force=true` path: verify roast delete is called, then sales delete, then inventory delete in order
4. Test `--force --yes` flag parsing doesn't prompt

---

## Risk Assessment

**Low.** The pre-flight check adds 2 reads before the delete but doesn't change the happy path for items with no dependencies. The `--force` path is additive (new flag). The return type change from `void` to an object is a minor breaking change for library callers, but since `deleteInventory` is exported from the public surface (`@purveyors/cli/inventory`), the version bump should be patch (behavior-preserving for existing callers who don't pass `--force` and don't have dependencies).

No schema changes required.

---

## Flywheel Note

The coffee-app DEVLOG lists this as **Priority 1**. Once the CLI pattern is established, coffee-app's delete endpoint (`/api/beans/delete` or similar) can adopt the same pre-check + cascade approach, and the chat agent's `delete_bean` tool (if added) can call `deleteInventory({ force: true })` directly via CLI import. One fix, two surfaces.

---

## Open Questions

1. Should `--force` delete roast temperatures/events records explicitly, or does the DB cascade handle those? (Schema shows `ON DELETE CASCADE` on `roast_temperatures.roast_id` and `roast_events.roast_id` → the DB handles it automatically when roast profiles are deleted. No action needed.)
2. Should the pre-flight check surface dependency IDs (e.g., list roast IDs) rather than just counts? Probably not for v1 — counts are enough to decide whether to proceed with `--force`. IDs can be obtained with `purvey roast list --coffee-id <id>`.
