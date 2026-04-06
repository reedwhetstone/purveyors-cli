# Plan: Distinct Exit Codes for Structured Error Categories

**Date:** 2026-04-06
**Slug:** distinct-exit-codes
**Priority:** High
**Risk:** Low-Medium

---

## Problem Description

All errors in `purvey` currently exit with code `1`, regardless of failure type. This means a caller (agent, shell script, CI step) cannot distinguish between:

- Invalid user input (`--sort bad-value`, `--ids abc`) → exit 1
- Not authenticated / wrong role → exit 1
- Resource not found (`roast ID 999 not found`) → exit 1
- Dependency conflict (`inventory item has roasts, use --force`) → exit 1
- Unexpected server/network error → exit 1

This is a direct violation of CLI composability best practices. Agents and shell pipelines must parse stderr text to determine what went wrong, which is fragile and breaks silently when error messages change.

**Evidence:**

- `src/lib/errors.ts` → `fatal()` always calls `process.exit(1)`, regardless of `error.code`
- `src/commands/catalog.ts` → 4 inline `process.exit(1)` calls bypassing `withErrorHandling`
- `src/commands/auth.ts` → 2 `process.exit(1)` calls
- `src/commands/roast.ts` → 2 `process.exit(1)` calls (inside interactive prompts)
- `src/index.ts` → 1 top-level `process.exit(1)` catch-all
- `PrvrsError` already has a `code` field (`INVALID_ARGUMENT`, `AUTH_ERROR`, `DEPENDENCY_CONFLICT`, `NOT_FOUND`, `CONFIG_ERROR`) — the semantic information exists but is never surfaced to the exit code

Current codes in use: `AUTH_ERROR`, `CONFIG_ERROR`, `INVALID_ARGUMENT`, `DEPENDENCY_CONFLICT`, `NOT_FOUND`

The last plan (2026-04-03) considered this and ranked it second. That plan has since shipped (findSimilarBeans tests). This is now the clearest structural gap remaining.

---

## Root Cause

The `fatal()` function was written with a single `process.exit(1)` path because distinguishing errors wasn't a priority early on. As the CLI matured into an agent-facing platform (consumed directly by `tools.ts` in coffee-app and by cron agents), the need for machine-readable exit codes became real. The `PrvrsError.code` field exists precisely for this purpose but is unused at the exit layer.

Additionally, several command files bypass `withErrorHandling` entirely and call `process.exit(1)` directly, so those paths are invisible to the error classification system.

---

## Proposed Fix

### Step 1: Define exit code constants in `src/lib/errors.ts`

```typescript
export const EXIT_CODES = {
  OK: 0,
  GENERAL_ERROR: 1, // unexpected/unclassified
  INVALID_ARGUMENT: 2, // bad user input (parse/validation errors)
  AUTH_ERROR: 3, // not authenticated or wrong role
  NOT_FOUND: 4, // resource does not exist
  DEPENDENCY_CONFLICT: 5, // would break referential integrity
  CONFIG_ERROR: 6, // bad local config state
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
```

### Step 2: Map `PrvrsError.code` → exit code in `fatal()`

```typescript
function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof PrvrsError) {
    return EXIT_CODES[error.code as keyof typeof EXIT_CODES] ?? EXIT_CODES.GENERAL_ERROR;
  }
  return EXIT_CODES.GENERAL_ERROR;
}

export function fatal(error: unknown): never {
  // ... existing stderr output unchanged ...
  process.exit(exitCodeForError(error));
}
```

### Step 3: Replace bare `process.exit(1)` calls with `throw new PrvrsError(...)`

The 4 inline `process.exit(1)` calls in `catalog.ts`, 2 in `auth.ts`, and 2 in `roast.ts` (non-interactive paths) should be converted to `throw new PrvrsError(...)` so they flow through `withErrorHandling` → `fatal()` and get the right exit code.

The 2 in `roast.ts` that are inside interactive prompts (`process.exit(0)` guards and `p.cancel()` + `process.exit(1)`) are edge cases; they can stay as `process.exit(1)` for now with a comment — converting those requires refactoring the interactive prompt flow.

### Step 4: Update `context.ts` / `purvey context` output

Add an `EXIT CODES` section to the agent reference so agents know to check `$?`:

```
EXIT CODES
----------
0  success
1  unexpected error
2  invalid argument / bad input
3  auth error (not logged in, wrong role)
4  resource not found
5  dependency conflict (use --force to override)
6  config error
```

### Files to Change

- `src/lib/errors.ts` — add `EXIT_CODES`, update `fatal()`
- `src/commands/catalog.ts` — convert 4 `process.exit(1)` → `throw new PrvrsError(...)`
- `src/commands/auth.ts` — convert 2 `process.exit(1)` → structured path (auth already uses `AuthError`)
- `src/commands/context.ts` — add EXIT CODES section to agent reference output
- `tests/cli-output-modes.test.ts` or new `tests/exit-codes.test.ts` — add exit-code assertion tests

---

## Acceptance Criteria

- [ ] `purvey catalog search --sort bad` exits with code 2
- [ ] `purvey catalog get 999` exits with code 3 (auth) or 4 (not found, once authenticated)
- [ ] `purvey inventory delete <id>` exits with code 5 when dependency conflict (without --force)
- [ ] `purvey auth status` when logged out exits with code 3
- [ ] All existing `fatal()` callers that throw `PrvrsError('INVALID_ARGUMENT', ...)` automatically get exit 2
- [ ] `purvey context` output includes an EXIT CODES section
- [ ] All existing tests still pass (431/431)
- [ ] At least 4 new integration-style tests validate exit codes for each category

---

## Test Plan

New tests (spawnSync pattern, same as `cli-output-modes.test.ts`):

```bash
cd repos/purveyors-cli
npx vitest run tests/exit-codes.test.ts
```

Test cases:

1. `purvey catalog search --sort invalid` → exit 2
2. `purvey auth status` (not logged in) → exit 3 (currently exits 1 — this is the visible regression fix)
3. `purvey catalog get notanumber` → exit 2 (invalid argument)
4. `purvey config get nonexistent-key` → exit 6 (config error)

---

## Risk Assessment

**Risk: Low-Medium**

- Exit code changes are technically breaking for any caller that checks `$? -eq 1` specifically
- In practice, the CLI has no known external shell-script consumers. Coffee-app uses the lib functions directly (not the CLI process), so `tools.ts` is unaffected
- The main risk is test fragility: `cli-output-modes.test.ts` asserts `expect(result.status).toBe(1)` for auth-not-logged-in — these need to be updated to `3`
- Interactive prompt paths (`roast import --form`, `roast watch`) call `process.exit(1)` inside `p.cancel()` — those stay as-is with a comment; risk of missing one is low because interactive paths are always TTY-gated

**Mitigation:** Update all `expect(result.status).toBe(1)` → `toBe(3)` for auth failures in existing tests as part of this PR.

---

## Why This Over Alternatives Considered

**Alternatives evaluated:**

1. **`update_roast_notes` → CLI lib function** — `updateRoast()` already exists in `src/lib/roast.ts` with `--notes` and `--targets` support. Coffee-app's `tools.ts` marks this as "no CLI equivalent yet" (line 48) and uses Supabase directly in `execute-action`. This is a real gap but it's in the execute-action layer (coffee-app), not the CLI itself. The CLI lib _does_ have the function; the gap is in how coffee-app calls it. Medium complexity, medium impact.

2. **Distinct exit codes** (selected) — `PrvrsError.code` already contains the right semantic information but it's thrown away at the exit boundary. Agents that shell out to `purvey` (or that wrap CLI calls) currently have no way to branch on error type without text-parsing stderr. Exit codes are the POSIX-standard signal. The fix is small and confined to `src/lib/errors.ts` + a cleanup pass on inline `process.exit(1)` calls. High composability impact, low implementation complexity.

3. **`fatal()` JSON error output mode** — When `--json` is passed and a command fails, the error goes to stderr as plain text. Agents in JSON mode would benefit from `{"error":"...", "code":"INVALID_ARGUMENT"}` on stderr. This would pair well with exit codes but is higher complexity (needs to thread output options into `fatal()`, which is called from deep in the handler chain). Good follow-up, not this PR.

4. **Inline `process.exit(1)` → `throw PrvrsError` in `catalog.ts`** — Subset of this plan. Considered as a standalone, but since the exit code change is the _reason_ to care about which error class gets thrown, doing them together is more coherent.

The exit code work is the highest-leverage composability improvement available today: it makes `purvey` a better Unix citizen, helps agents branch on failure type without text parsing, and requires touching a small number of files with well-defined scope.

---

## Open Questions

- Should `roast watch` and `roast import --form` interactive `process.exit(1)` paths be converted in this PR or deferred? Recommend defer — they're TTY-only paths that agents never hit.
- Should we publish this as a minor version bump (composability change) or patch? Recommend **minor** (0.9.x → 0.10.0) since exit codes are a semver-observable behavior change.
