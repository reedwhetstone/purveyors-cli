# Plan: Make the CLI output contract real (`--json` + TTY-aware structured output)

## Problem

`purveyors-cli` advertises a machine-friendly output contract that is only partially implemented:

- `src/index.ts` help text advertises a global `--json` flag
- `src/types/index.ts` already models `json?: boolean` in `GlobalOptions`
- `src/commands/catalog.ts` already checks `globalOpts.json` inside `catalog similar`
- but the root program does **not** actually register `--json`

That produces a bad onboarding and scripting experience:

```bash
$ purvey --json catalog search --limit 1
error: unknown option '--json'

$ purvey catalog search --json --limit 1
error: unknown option '--json'
```

There is a second contract break in `catalog similar`:

- README says all `purvey` commands default to compact JSON
- `purvey context` says stdout is always clean data and default output is compact JSON
- but `catalog similar` defaults to a human-readable table, even for non-interactive usage
- `catalog similar` also ignores `--csv` today because it only special-cases `json` and `pretty`

This matters for both humans and agents:

- agents following `purvey context` or command help hit a fake flag
- shell pipelines cannot rely on a consistent output contract
- `catalog similar` is much less composable than the rest of the CLI

## Evidence

### 1. Root parser advertises `--json` but does not register it

`src/index.ts` currently defines:

- `--pretty`
- `--csv`

But the help text later says:

```text
Global Options:
  --json            Output as JSON (default for most commands)
```

### 2. Types and command handlers already assume `--json` exists

`src/types/index.ts`:

- `GlobalOptions` includes `json?: boolean`
- `OutputOptions` does **not** include it, forcing ad-hoc casts elsewhere

`src/commands/catalog.ts`:

```ts
const globalOpts = cmd.optsWithGlobals() as OutputOptions & { json?: boolean };
...
if (globalOpts.json) {
  console.log(JSON.stringify(filtered));
  return;
}
```

That is dead-path behavior until the root program actually accepts the option.

### 3. `catalog similar` violates the documented output contract

README currently says:

```md
All `purvey` commands default to compact JSON
```

But `catalog similar` currently does this:

- `--json` → raw JSON array
- `--pretty` → pretty JSON
- otherwise → human-readable table via `console.log()`

It also never routes `--csv` through `outputData()`, so `--csv` is silently ignored for this command.

### 4. `auth status` still would not honor explicit `--json`

`src/commands/auth.ts` uses:

```ts
const isInteractive = process.stdout.isTTY && !opts.pretty && !opts.csv;
```

If `--json` is added at the root, this command would still choose the human-readable path in a TTY unless it also checks `!opts.json`.

## Root Cause

The output mode contract is duplicated across four layers with no single source of truth:

1. Root CLI option registration (`src/index.ts`)
2. Output option types (`src/types/index.ts`)
3. Command-level interactive/machine branching (`src/commands/auth.ts`, `src/commands/catalog.ts`)
4. Onboarding/docs surfaces (`src/index.ts` help text, `src/commands/context.ts`, `README.md`)

The types and docs evolved ahead of the parser wiring. Then `catalog similar` implemented a special human-readable path without reusing the same TTY-aware logic as `auth status`, so output semantics drifted further.

## Proposed Fix

### 1. Register a real global `--json` flag in `src/index.ts`

Add:

```ts
.option('--json', 'Output compact JSON explicitly (useful in terminals and scripts)')
```

This should work before or after subcommands, matching existing examples like:

```bash
purvey catalog similar 1182 --json | jq '.[0]'
```

### 2. Make output-mode typing consistent

Update `src/types/index.ts` so the shared output options type includes `json?: boolean`.

Recommended cleanup:

- add `json?: boolean` to `OutputOptions`, or
- collapse `OutputOptions` into the existing `GlobalOptions` if they now mean the same thing

Goal: remove ad-hoc `& { json?: boolean }` casts from command handlers.

### 3. Extract one shared helper for human-vs-structured output

Add a small helper in `src/lib/output.ts` such as:

```ts
export function shouldUseInteractiveOutput(
  options: { pretty?: boolean; csv?: boolean; json?: boolean },
  isTTY = process.stdout.isTTY
): boolean {
  return Boolean(isTTY && !options.pretty && !options.csv && !options.json);
}
```

Why this matters:

- avoids repeating branching logic in multiple commands
- makes the output contract explicit and testable
- follows the repo's "Never Repeat Truth" rule

### 4. Update `auth status` to honor explicit `--json`

In `src/commands/auth.ts`:

- use the shared helper instead of the inline `isInteractive` check
- `purvey auth status --json` should always emit compact JSON to stdout, even in a TTY
- preserve current friendly terminal behavior when no output-mode flag is given

### 5. Make `catalog similar` TTY-aware and route structured output through `outputData()`

In `src/commands/catalog.ts`:

- replace the special-case `if (globalOpts.json) console.log(JSON.stringify(filtered))`
- use the shared helper to choose between:
  - interactive terminal table output
  - structured output via `outputData(filtered, globalOpts)`

That gives the right behavior for all cases:

- interactive terminal, no flag → human-readable table
- piped/redirection, no flag → compact JSON
- `--json` → compact JSON even in terminal
- `--pretty` → pretty JSON
- `--csv` → real CSV output

### 6. Align docs with actual behavior

Update:

- `src/index.ts` help text
- `src/commands/context.ts` output format guidance
- `README.md` output format section and at least one `catalog similar` example

Document one simple rule:

- default non-interactive output is compact JSON
- interactive-only friendly formatting is allowed for selected commands
- `--json` forces compact JSON explicitly

## Files to Change

| File                             | Change                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/index.ts`                   | Register global `--json`; keep help text accurate                                                    |
| `src/types/index.ts`             | Add `json` to shared output options typing; remove drift between `GlobalOptions` and `OutputOptions` |
| `src/lib/output.ts`              | Add shared helper for interactive vs structured output                                               |
| `src/commands/auth.ts`           | Honor `--json` in TTY mode via shared helper                                                         |
| `src/commands/catalog.ts`        | Make `catalog similar` use TTY-aware branching and `outputData()` for JSON/pretty/CSV                |
| `src/commands/context.ts`        | Update output-mode guidance and explicit `--json` usage                                              |
| `README.md`                      | Update output-format docs and `catalog similar` example(s)                                           |
| `tests/output.test.ts`           | Add truth-table tests for the shared helper                                                          |
| `tests/cli-output-modes.test.ts` | Add CLI smoke tests for `--json` acceptance and non-interactive structured output                    |

## Components Sharing This Pattern

These are the commands/surfaces that share the same output-mode pattern and should stay aligned:

1. `src/index.ts` root global options
2. `src/commands/auth.ts` (`auth status` interactive special case)
3. `src/commands/catalog.ts` (`catalog similar` interactive special case)
4. `src/commands/context.ts` onboarding text
5. `README.md` output contract docs
6. `src/types/index.ts` shared output option types

## Acceptance Criteria

- [ ] `purvey --json catalog search --limit 1` is accepted and outputs compact JSON
- [ ] `purvey catalog search --json --limit 1` is accepted and outputs compact JSON
- [ ] `purvey auth status --json` outputs JSON to stdout even when run in an interactive terminal
- [ ] `purvey catalog similar <id> --json` outputs compact JSON instead of the human-readable table
- [ ] `purvey catalog similar <id> --csv` outputs CSV instead of ignoring the flag
- [ ] `purvey catalog similar <id> | jq '.[0]'` works without needing `--json` because non-interactive default becomes structured output
- [ ] `purvey catalog similar <id>` in an interactive terminal still shows the friendly table
- [ ] `README.md`, `purvey --help`, and `purvey context` all describe the same output behavior
- [ ] No existing JSON/pretty/CSV behavior regresses for standard commands like `catalog search`, `inventory list`, or `sales list`

## Test Plan

### Unit tests

1. Add helper tests in `tests/output.test.ts` covering:
   - TTY + no flags => interactive output allowed
   - TTY + `json` => structured output
   - TTY + `pretty` => structured output
   - TTY + `csv` => structured output
   - non-TTY + no flags => structured output

### CLI smoke tests

Add `tests/cli-output-modes.test.ts` with lightweight subprocess checks, e.g. via `pnpm dev -- ...`:

1. `purvey --json --help` does not error with unknown option
2. `purvey catalog search --json --help` does not error with unknown option
3. `purvey catalog search --limit 1` still returns parseable JSON in non-interactive mode
4. `purvey auth status --json` returns JSON-shaped output or a JSON-shaped not-authenticated object, not human text

### Manual smoke tests

1. `purvey catalog similar 1182` in a terminal still prints the ranked human table
2. `purvey catalog similar 1182 --json | jq '.[0]'`
3. `purvey catalog similar 1182 --csv | head`
4. `purvey auth status --json`

## Risk Assessment

**Low.** This is an output-contract fix, not a data-write change.

Primary risks:

1. **Behavioral surprise for `catalog similar` users who relied on table output in pipes**
   - Mitigation: only switch to structured output for non-interactive usage; keep the interactive table unchanged

2. **Commander option parsing edge cases**
   - Mitigation: smoke-test both forms:
     - `purvey --json ...`
     - `purvey subcommand --json ...`

3. **Docs drifting again later**
   - Mitigation: use one shared helper and one shared output-options type so the implementation is harder to partially wire

## Why This One

This beat the other candidates because it is:

- **high impact**: fixes a fake documented flag and restores scripting composability
- **flywheel-positive**: agents and humans both benefit immediately; `catalog similar` becomes usable in pipelines
- **small and shippable**: mostly output logic and docs, no schema or DB work
- **low risk**: no mutations, no auth flow changes, no API contract changes beyond making the documented contract true

## Alternatives Considered

### 1. Finish the remaining catalog server-side filters (`variety`, `drying_method`, `stocked_days`)

Not selected because yesterday's plan already targeted this, and the repo currently has uncommitted work in exactly those files (`src/lib/catalog.ts`, `src/commands/catalog.ts`, `tests/catalog.test.ts`). Duplicating that plan would be wasted motion.

### 2. Broader help/context single-source generation

Good follow-up, but broader scope. The output-contract bug is sharper because it is both a docs lie **and** a runtime failure today.
