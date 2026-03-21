# Implementation Plan: Add `--targets` to `roast update` + Wire CLI in coffee-app

**Date:** 2026-03-20
**CLI Version:** 0.6.2 (next: 0.6.3)
**Plan ID:** 2026-03-20-roast-update-targets-field

---

## What and Why

`purvey roast update` (added in PR #38, v0.6.2) supports `--notes`, `--oz-out`, and `--batch-name` — but is
missing `--targets` (`roast_targets` column). This is a direct gap vs. coffee-app's `update_roast_notes`
AI tool, which accepts both `roast_notes` and `roast_targets`.

Consequence: `execute-action` in coffee-app cannot be migrated to use the CLI lib — it still calls Supabase
directly for `update_roast_notes`. The comment in `tools.ts` still says "no CLI equivalent yet", which is
now misleading (there is a CLI, it just can't handle `roast_targets`).

This plan closes the gap in two parts:

1. **CLI:** Add `--targets` to `roast update` (1-line schema + lib + command change)
2. **coffee-app:** Update `tools.ts` comment + `execute-action` to use `updateRoast()` from `@purveyors/cli/roast`

---

## Files to Change

### purveyors-cli

**`src/lib/roast.ts`**

- Add `targets: z.string().optional()` to `updateRoastSchema`
- In `updateRoast()`: map `parsed.targets` → `updates.roast_targets`

**`src/commands/roast.ts`**

- Add `.option('--targets <text>', 'Updated roast targets')` to `roast update` command
- Pass `targets: opts.targets` through to `updateRoast()` call
- Update the "at least one required" check to include `--targets`
- Update addHelpText examples

**`src/commands/context.ts`**

- Add `--targets <text>` to the `roast update` Options block in the agent reference string

**`tests/roast-update.test.ts`**

- Add: `it('accepts targets only', ...)` — `updateRoastSchema.safeParse({ targets: '...' })`
- Add: `it('accepts notes + targets together', ...)` — both fields valid
- Update the "rejects empty object" test description to confirm `targets` is now also a valid single field

### coffee-app (requires dep bump after CLI publish)

**`src/lib/services/tools.ts`**

- Update the `update_roast_notes` comment from "no CLI equivalent yet" to "→ execute-action calls updateRoast()"
- Update `execute-action` comment reference to reflect CLI availability

**`src/routes/api/chat/execute-action/+server.ts`**

- Replace raw Supabase block for `update_roast_notes` with `updateRoast()` from `@purveyors/cli/roast`
- Import: `import { updateRoast } from '@purveyors/cli/roast'`
- Pass `notes: params.roast_notes, targets: params.roast_targets` (once `--targets` is in CLI)

---

## Acceptance Criteria

**CLI side:**

- [ ] `purvey roast update <id> --targets "Aim for FC at 390F"` updates `roast_targets` in DB
- [ ] `purvey roast update <id> --notes "..." --targets "..."` updates both fields
- [ ] Empty-object validation still rejects calls with no flags
- [ ] All existing `roast-update.test.ts` tests still pass; new tests added for `targets`
- [ ] `purvey context` output includes `--targets <text>` in the `roast update` options block
- [ ] Version bumped to 0.6.3 in `package.json`

**coffee-app side (follow-up after CLI publish):**

- [ ] `execute-action` for `update_roast_notes` uses `updateRoast()` from `@purveyors/cli/roast`
- [ ] `tools.ts` comment updated to show CLI path
- [ ] No Supabase direct calls remain in the `update_roast_notes` case
- [ ] CI (Playwright + type check) green

---

## Expected Impact

- **Completeness:** CLI now covers 100% of the fields that `update_roast_notes` needs
- **Consistency:** `execute-action` moves to the same auth/validation path as every other write operation
- **Agent accuracy:** `purvey context` output will correctly reflect the full `roast update` surface; agents
  won't produce invalid CLI calls by omitting `--targets`
- **Flywheel:** coffee-app execute-action migration eliminates ~30 lines of raw SQL and reduces the drift
  surface between CLI and app logic

---

## Risk Assessment

**Very low.** This is purely additive:

- Schema change adds an optional field — no breaking change
- Existing tests all remain valid
- `roast_targets` column already exists in the DB (`roast_profiles` table), used by the create flow
- coffee-app migration: behavior-identical swap (same DB call, same ownership check, same fields)

---

## Sequencing

1. **PR A (purveyors-cli):** `--targets` field + schema + tests + context update + version bump to 0.6.3
2. Merge + tag + publish to npm
3. **PR B (coffee-app):** Bump `@purveyors/cli` dep + migrate `execute-action` `update_roast_notes` case

Coffee-app dep bump is a minor patch (0.6.2 → 0.6.3), so `^0.6.0` range auto-resolves it.

---

## Open Questions

- None. The `roast_targets` column exists, the field name is consistent across the codebase, and the
  migration path is already established by other execute-action cases (e.g., `create_roast_session`).
