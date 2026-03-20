# Implementation Plan: Add `purvey roast update` Command

**Date:** 2026-03-19  
**CLI Version:** 0.6.2  
**Plan ID:** 2026-03-19-roast-update-command

---

## What and Why

The CLI is missing a `roast update` command to modify existing roast profiles. This gap is explicitly noted in `coffee-app/src/lib/services/tools.ts`:

> "No direct CLI equivalent yet — execute-action uses Supabase directly"

Adding this command will:

1. Complete the CRUD surface for roast profiles (create, read, **update**, delete)
2. Enable the chat agent to migrate `update_roast_notes` from direct Supabase calls to CLI-backed execution
3. Follow the established pattern used by `sales update` and `inventory update`

**Fields to support:**

- `roast_notes` — freeform text notes about the roast
- `roast_targets` — targets/goals for the roast session
- `oz_out` — roasted weight output (triggers weight loss % recalculation)
- `batch_name` — batch name for the roast

---

## Files to Change

### 1. `src/lib/roast.ts` — Add library function

**New function:** `updateRoast()`

```typescript
export const updateRoastSchema = z.object({
  notes: z.string().optional(),
  targets: z.string().optional(),
  ozOut: z.number().positive().optional(),
  batchName: z.string().optional(),
}).refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
  message: 'No update fields provided. Pass at least one of: --notes, --targets, --oz-out, --batch-name.',
});

export type UpdateRoastInput = z.input<typeof updateRoastSchema>;

export async function updateRoast(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: UpdateRoastInput
): Promise<RoastProfile> { ... }
```

**Logic:**

1. Verify roast profile belongs to userId (RLS check)
2. Build update payload with provided fields
3. If `ozOut` provided and `oz_in` exists on record, recalculate `weight_loss_percent`
4. Update `last_updated` timestamp
5. Return updated roast profile

### 2. `src/commands/roast.ts` — Add command handler

**New subcommand:** `roast update <id>`

```typescript
roast
  .command('update <id>')
  .description('Update an existing roast profile (must be yours)')
  .option('--notes <text>', 'Updated roast notes')
  .option('--targets <text>', 'Updated roast targets')
  .option('--oz-out <oz>', 'Updated roasted weight (oz) — triggers weight loss recalculation')
  .option('--batch-name <name>', 'Updated batch name')
  .action(...)
```

**Behavior:**

- Requires at least one flag (enforced by schema)
- Parse `<id>` as integer
- Call `updateRoast()` from lib
- Output updated profile via `outputData()`

### 3. `tests/roast-update.test.ts` — Add tests (new file)

Test cases:

1. Update notes only — success
2. Update oz_out with oz_in present — verify weight_loss_percent recalculation
3. Update oz_out without oz_in — no weight loss calc (avoid div by zero)
4. Update non-existent roast — throws NOT_FOUND
5. Update roast belonging to other user — throws AUTH_ERROR
6. No fields provided — throws INVALID_ARGUMENT
7. Invalid roast ID (non-numeric) — throws INVALID_ARGUMENT

### 4. `AGENTS.md` — Update architecture tree

Add `updateRoast()` to the lib/roast.ts exports list in the architecture diagram.

### 5. `src/commands/context.ts` — Update agent reference

Add `roast update` section to CONTEXT_TEXT with examples.

---

## Acceptance Criteria

- [ ] `purvey roast update 123 --notes "New notes"` updates roast_notes
- [ ] `purvey roast update 123 --oz-out 12.5` updates oz_out and recalculates weight_loss_percent
- [ ] `purvey roast update 123 --targets "FC at 9:30"` updates roast_targets
- [ ] `purvey roast update 123 --batch-name "New Name"` updates batch_name
- [ ] Multiple flags can be combined in one call
- [ ] Returns updated roast profile as JSON (or pretty/CSV per global opts)
- [ ] Exits with code 1 on error (not found, auth error, invalid args)
- [ ] All tests pass (`pnpm test`)
- [ ] Type check passes (`pnpm check`)
- [ ] Lint passes (`pnpm lint`)

---

## Expected Impact

**User impact:** High

- Completes roast profile CRUD surface
- Enables scripted roast metadata updates
- Supports batch updates via shell scripts

**Agent impact:** High

- Chat agent can migrate `update_roast_notes` tool to use CLI
- Consistent error handling and output formatting
- One less direct Supabase dependency in chat tools

**Risk:** Low

- Follows established `update` pattern (sales, inventory)
- Pure additive change — no existing behavior modified
- RLS-enforced — cannot modify other users' roasts

---

## Weight Loss Calculation

When `ozOut` is provided and the roast profile has `oz_in`:

```typescript
const weightLossPercent = ((ozIn - ozOut) / ozIn) * 100;
// Store rounded to 2 decimal places
```

If `oz_in` is null/undefined, skip the calculation (weight_loss_percent remains unchanged).

---

## Coffee-App Dependency

This change **does not require** a coffee-app dependency bump. The coffee-app can migrate to use the new `updateRoast` function in a separate PR after this CLI change is published.

When coffee-app does migrate:

- Import `updateRoast` from `@purveyors/cli/roast`
- Update `execute-action` endpoint to call CLI instead of direct Supabase
- Remove "no CLI equivalent yet" comment from tools.ts

---

## Open Questions

1. **Should we support `--roast-date` update?**
   - Recommendation: No for now. Roast date is a fundamental identifier; changing it could break workflows. Can add later if requested.

2. **Should oz_out update trigger any other side effects?**
   - Recommendation: Only weight_loss_percent recalculation. No other fields affected.

3. **Batch update support?**
   - Recommendation: Out of scope. Single-roast updates cover 99% of use cases. Batch updates can be done via shell loop.

---

## Implementation Notes

- Follow exact pattern from `sales update` command (structure, error handling, output)
- Use `PrvrsError('INVALID_ARGUMENT', ...)` for validation errors
- Use `AuthError` for permission/not-found errors
- Ensure `withErrorHandling` wrapper is used
- Test file can borrow setup patterns from `roast-import.test.ts`
