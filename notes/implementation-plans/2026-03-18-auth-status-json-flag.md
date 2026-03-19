# Implementation Plan: `purvey auth status` JSON-by-default behavior

**Date:** 2026-03-18
**Status:** Ready for implementation
**Complexity:** Small (1 file, ~10 lines changed)
**Risk:** Low

---

## What and Why

`purvey auth status` today has an inconsistency that hurts agent usability:

- Without `--pretty`, it prints human-readable text **to stderr** and exits 0 on success, producing **no stdout output at all**
- With `--pretty`, it outputs structured JSON to stdout
- With `--csv`, it outputs CSV to stdout
- **`--json` flag does not exist on `auth status`** (unlike other commands)

Every other command in the CLI defaults to compact JSON on stdout. `auth status` is the exception — it falls through to a human-readable path when neither `--pretty` nor `--csv` is passed. This means an agent or script that runs:

```bash
result=$(purvey auth status)
```

...gets an empty string. To get parseable output, the caller currently must remember to pass `--pretty` (which gives colorized JSON, not ideal for scripts) or parse stderr.

Additionally, `GlobalOptions` in `src/types/index.ts` already declares a `json?: boolean` field, but `auth status` never wires it up. The option is declared in the type but never registered on the command.

### The Gap in Practice

From today's live test:

```bash
$ purvey auth status 2>/dev/null   # stdout: empty
$ purvey auth status               # stderr: spinner + human messages
$ purvey auth status --pretty      # stdout: JSON (but colorized, not machine-clean)
$ purvey auth status --json        # error: unknown option '--json'
```

For agents, the intended flow is `purvey auth status | jq '.role'`. This silently fails today because stdout is empty by default.

---

## Root Cause

In `src/commands/auth.ts`, `statusAction` branches on `opts.pretty || opts.csv` to decide between machine and human output:

```typescript
if (!opts.pretty && !opts.csv) {
  // Human-readable path: prints to stderr, returns
  success(`Logged in as ...`);
  info(`Role: ...`);
  info(`Token expires: ...`);
  return; // <-- exits without writing to stdout
}
outputData(result, opts);
```

The human-readable branch should only fire when output is explicitly directed at a human terminal (i.e., stdout is a TTY). If stdout is a pipe or file, the default should be JSON — matching every other command.

---

## Files to Change

| File                      | Change                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/commands/auth.ts`    | Fix `statusAction` output logic: default to JSON when stdout is not a TTY; keep human-readable path for interactive terminals.                                 |
| `src/commands/context.ts` | Update the `CONTEXT_TEXT` constant: `auth status` section should document that default output is JSON (remove the need to pass `--pretty` for machine output). |

No other files need changes. No new dependencies.

---

## Implementation Approach

### Option A (Recommended): TTY detection

Change the branching condition in `statusAction` from "pretty or csv?" to "is stdout a TTY?":

```typescript
const isInteractive = process.stdout.isTTY;

if (isInteractive && !opts.pretty && !opts.csv) {
  // Human-readable: spinner feedback already printed above, just add role/expiry
  success(`Logged in as ${chalk.bold(session.email)}`);
  info(`Role: ${result.role}`);
  info(`Token expires: ${result.tokenExpires}`);
  return;
}

// Machine-readable (also used for --pretty and --csv)
outputData(result, opts);
```

This is consistent with how CLI tools in general (git, docker, gh) handle mixed human/machine output.

**Behavior after:**

- `purvey auth status` in terminal: human-readable as before
- `purvey auth status | jq '.role'`: compact JSON on stdout
- `purvey auth status --pretty`: indented colorized JSON
- `purvey auth status > file.json`: compact JSON in file

### Option B: Add `--json` flag explicitly

Register `--json` as an option on the `auth status` subcommand, treat it as "force JSON output":

```typescript
auth.command('status')
  .option('--json', 'Output as JSON (default for piped output)')
  ...
```

This is less elegant — it requires callers to explicitly remember `--json` rather than just letting pipes work naturally. Option A is more Unix-idiomatic.

**Recommendation: Option A (TTY detection).** More consistent with CLI conventions; no flag to document or remember.

### Also fix the not-logged-in path

The `!session` branch has the same issue: when not logged in and not pretty/csv, it `warn()`s to stderr and exits 1 without writing to stdout. TTY detection should cover this path too:

```typescript
if (isInteractive && !opts.pretty && !opts.csv) {
  warn(result.message);
  process.exit(1);
}
outputData(result, opts);
process.exit(1);
```

### Update context.ts

The `CONTEXT_TEXT` in `src/commands/context.ts` currently says:

```
purvey auth status --pretty
purvey auth status | jq '.email'
```

After the fix, the `--pretty` qualifier is no longer needed for pipe-based usage. Update the agent reference to:

```
purvey auth status           # compact JSON by default when piped
purvey auth status --pretty  # indented/colorized (human reading)
purvey auth status | jq '.email'
```

Also bump the version header from `v0.5` to `v0.6` to match current package.json version.

---

## Acceptance Criteria

1. `result=$(purvey auth status 2>/dev/null) && echo "$result" | jq '.role'` prints `"member"` without errors
2. `purvey auth status` in a terminal still shows spinner + human-readable lines (unchanged for interactive use)
3. `purvey auth status --pretty` still prints indented colorized JSON
4. `purvey auth status 2>/dev/null | jq '.authenticated'` prints `true`
5. When not logged in: `purvey auth status 2>/dev/null | jq '.authenticated'` prints `false` (not empty)
6. Exit code 1 on not-logged-in is preserved
7. `purvey context` reflects the updated behavior (no `--pretty` required for machine use)
8. No breaking changes to the `--pretty` and `--csv` paths

---

## Expected Impact

**Direct:** Any agent, script, or cron that calls `purvey auth status` to check login state can now pipe the output to `jq` without needing `--pretty`. The CLI onboarding reference (`purvey context`) becomes accurate for this command.

**Flywheel:** coffee-app's `tools.ts` doesn't use `auth status` directly (auth is handled server-side), but future agentic scripts that bootstrap or verify CLI sessions will work correctly without workarounds. Agents following the `purvey context` reference won't hit a surprise empty-stdout on their first auth check.

**Code quality:** Removes an inconsistency in the output contract. Every command now follows the same rule: compact JSON by default, human formatting only for interactive TTY sessions.

---

## Risk Assessment

**Low.** The change is additive behavior (new output path) rather than removing existing behavior. Interactive use (`purvey auth status` in a terminal) is unchanged by TTY detection. The only behavioral change is for piped/redirected invocations — which currently produce empty stdout, so any breakage would be an improvement over the status quo.

**Edge case:** CI environments or environments where `process.stdout.isTTY` is undefined (some Docker setups). In that case, `isTTY` is `undefined`, which is falsy — the machine-readable path fires, which is the correct behavior for non-interactive environments.

---

## Does It Require a coffee-app Dep Bump?

No. This is a CLI behavior fix with no API surface changes. The subpath exports (`./lib`, etc.) are unaffected. coffee-app does not import from `./auth` or call `auth status` in tools.ts. No dep bump needed.

---

## Version Bump

This is a patch-level fix (behavior correction, not new feature). Bump `package.json` version from `0.6.0` → `0.6.1` in the PR.
