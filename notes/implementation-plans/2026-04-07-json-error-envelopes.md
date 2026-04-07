# Plan: Emit structured JSON error envelopes in machine-output modes

**Date:** 2026-04-07
**Slug:** json-error-envelopes
**Priority:** High
**Complexity:** Low-Medium
**Risk:** Low-Medium

---

## Problem Description

`purveyors-cli` now has distinct process exit codes, but its error _payload_ contract is still inconsistent. In machine-output modes, some commands return structured JSON while most fatal paths still emit plain chalk-colored text to stderr.

That creates a half-finished composability story:

- callers can branch on `$?`
- but they still cannot reliably parse the error payload without scraping human text
- different commands expose different error shapes for similar failure states

### Evidence

#### 1. `auth status --json` returns structured JSON on an auth failure

Current behavior:

```bash
$ pnpm exec tsx src/index.ts auth status --json
# exit 3
# stdout:
{"authenticated":false,"message":"Not logged in. Run `purvey auth login` to authenticate."}
# stderr:
- Checking authentication status...
```

This establishes that the CLI already treats unauthenticated state as structured data in at least one machine-facing path.

#### 2. Most other `--json` failures still emit plain text only

Current behavior:

```bash
$ pnpm exec tsx src/index.ts catalog search --sort bogus --json
# exit 2
# stdout:
#   <empty>
# stderr:
✖ Invalid --sort value: "bogus". Must be one of: price, price-desc, name, origin, newest
```

So the same CLI that advertises compact JSON by default still falls back to human-only stderr formatting for invalid arguments on most commands.

#### 3. The error layer is hardcoded to human formatting

`src/lib/errors.ts` currently does two things only:

- formats errors as chalk-colored text
- exits with `exitCodeForError(error)`

The `fatal()` path has no notion of output mode. It cannot tell whether the caller explicitly requested `--json`, `--pretty`, or another structured mode.

#### 4. The repo already has an unused structured error type

`src/types/index.ts` defines:

```ts
export interface CliError {
  code: string;
  message: string;
  details?: unknown;
}
```

That strongly suggests structured error output was intended, but never wired into the actual CLI boundary.

#### 5. This gap already blocked a recent feature plan from fully landing its machine contract

`notes/implementation-plans/2026-04-02-inventory-delete-dependency-check.md` includes this acceptance criterion:

- `Error code DEPENDENCY_CONFLICT is returned in JSON error output`

The related PR audit explicitly flagged that criterion as deferred because `fatal()` still only emits plain text.

#### 6. Recent work made this the next obvious leverage point

On 2026-04-06, PR #76 added distinct exit codes and documented them in `purvey context`. That solved process-level branching, but the payload-level contract is still inconsistent. This is now the most obvious remaining machine-interface gap.

---

## Root Cause Analysis

The CLI's output contract is split across two separate systems:

1. **Success/data output** goes through `outputData()` and respects structured modes.
2. **Fatal error output** goes through `fatal()` and ignores structured modes.

That split causes three structural problems:

### 1. Output mode knowledge never reaches the error boundary

Command handlers know about `cmd.optsWithGlobals()` and can pass `OutputOptions` into `outputData()`. But once an error bubbles into `withErrorHandling()` / `fatal()`, the formatter only sees the error object.

### 2. Error formatting duplicates output concerns instead of sharing them

`src/lib/output.ts` already owns compact JSON, pretty JSON, and colorization behavior. `src/lib/errors.ts` reimplements its own separate human-text formatting path instead of sharing the same structured-output rules.

### 3. The CLI treats machine output as a success-only concern

The current design assumes structured output matters only when a command succeeds. For agent and shell consumers, that is backwards. The error path is where stable shape matters most.

---

## Proposed Fix

### 1. Introduce a single machine-error envelope

Define a structured error shape for process-boundary failures:

```ts
interface CliErrorEnvelope {
  error: true;
  code: string;
  exitCode: number;
  message: string;
  details?: unknown;
}
```

Recommended defaults:

- `code`: `PrvrsError.code` when available, otherwise `GENERAL_ERROR` or `INVALID_ARGUMENT` for `ZodError`
- `exitCode`: output of `exitCodeForError(error)`
- `message`: same message humans currently see
- `details`: included only when already safe/intentional, ideally gated behind `PURVEY_DEBUG` to preserve current behavior

This keeps the JSON contract small, stable, and useful.

### 2. Detect structured-output intent at the error boundary

Add a shared helper that resolves whether the current invocation wants:

- human-readable error text
- compact JSON error output
- pretty JSON error output

The simplest durable source of truth is the invocation context itself:

- explicit flags in `process.argv` (`--json`, `--pretty`, `--csv`)
- TTY state, using the same philosophy as `shouldUseInteractiveOutput()`

Recommended rule:

- `--pretty` → pretty JSON error to stderr
- `--json` or `--csv` → compact JSON error to stderr
- non-interactive mode with no explicit flag → compact JSON error to stderr
- interactive mode with no structured flag → current human-readable stderr output

This keeps the error contract aligned with the repo's broader machine-output contract instead of making `--json` a special-case patch.

### 3. Extract shared JSON formatting instead of duplicating it

`src/lib/output.ts` already knows how to render:

- compact JSON
- pretty JSON
- syntax-colored pretty JSON

Extract the string-formatting portion into a reusable helper, for example:

```ts
formatStructuredOutput(data, { pretty?: boolean }): string
```

Then:

- `outputData()` writes that string to stdout
- `fatal()` writes the same formatting style to stderr

This follows the repo's "Never Repeat Truth" rule and prevents success/error formatting drift.

### 4. Update `fatal()` to emit structured envelopes in machine modes

Behavior after the change:

- **Human interactive mode:** preserve current red `✖ message` formatting
- **Machine mode:** emit JSON error envelope to **stderr**, keep **stdout empty**, then exit with the existing structured exit code

Keeping JSON errors on stderr is the safer Unix choice:

- stdout remains reserved for successful command data
- non-zero exit still signals failure
- parsers can opt into `2>` handling without mixing error objects into success streams

### 5. Document the contract explicitly

Update README and `purvey context` to say:

- successful structured data goes to stdout
- fatal errors in machine mode emit JSON to stderr
- exit codes remain the canonical process-level signal
- `auth status` remains a special status-style command that returns a structured auth-state object on stdout even when unauthenticated

That last bullet matters. `auth status` should stay intentionally special unless there is a separate decision to redesign it.

### 6. Add regression tests at the CLI boundary

Add tests that exercise the real process surface, not just helper functions.

Key cases:

1. invalid catalog sort with `--json`
2. invalid catalog sort with `--pretty`
3. `fatal(new PrvrsError('DEPENDENCY_CONFLICT', ...))` fixture with `--json`
4. `fatal(new PrvrsError('AUTH_ERROR', ...))` fixture with `--json`
5. human interactive mode still prints the current text error format

---

## Files to Change

| File                             | Change                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/errors.ts`              | Add machine-error envelope builder, output-mode resolution, structured stderr formatting in `fatal()` |
| `src/lib/output.ts`              | Extract reusable JSON formatter so success and error paths share one formatting source of truth       |
| `src/types/index.ts`             | Reuse or extend `CliError` into the actual envelope type used at runtime                              |
| `src/commands/context.ts`        | Document machine-mode error contract in the agent reference                                           |
| `README.md`                      | Document JSON error behavior for `--json` / non-interactive usage                                     |
| `tests/exit-codes.test.ts`       | Add fixture-backed assertions for AUTH_ERROR / DEPENDENCY_CONFLICT JSON stderr envelopes              |
| `tests/cli-output-modes.test.ts` | Add end-to-end CLI assertions for `catalog search --sort bogus --json` and `--pretty`                 |
| `tests/fixtures/fatal-exit.ts`   | Reuse for process-boundary JSON error tests with argv flags                                           |
| `package.json`                   | Version bump                                                                                          |

---

## Components Sharing This Pattern

This is a cross-cutting output-contract fix. The following components share the pattern and should stay aligned:

1. `src/lib/output.ts` — structured success formatting
2. `src/lib/errors.ts` — structured failure formatting
3. `src/index.ts` — root process boundary and top-level catch path
4. All subcommands wrapped with `withErrorHandling()`:
   - `catalog`
   - `inventory`
   - `roast`
   - `sales`
   - `tasting`
   - `config`
   - `auth` login/headless/logout paths
5. `src/commands/context.ts` — agent-facing contract docs
6. `README.md` — public CLI contract docs

Notably excluded from this plan's behavior changes:

- `auth status` unauthenticated JSON status payload
- Commander-native parse/help errors (`unknown option`, usage output)
- interactive `@clack/prompts` flows

Those can be revisited later, but they should not block this smaller contract fix.

---

## Acceptance Criteria

- [ ] `pnpm exec tsx src/index.ts catalog search --sort bogus --json` exits 2, writes **no stdout**, and writes parseable JSON to stderr with `code: "INVALID_ARGUMENT"`
- [ ] `pnpm exec tsx src/index.ts catalog search --sort bogus --pretty` exits 2 and writes pretty JSON error output to stderr
- [ ] `fatal(new PrvrsError('DEPENDENCY_CONFLICT', ...))` produces a structured JSON envelope in machine mode
- [ ] `fatal(new PrvrsError('AUTH_ERROR', ...))` produces a structured JSON envelope in machine mode
- [ ] Human interactive error output remains unchanged for commands without structured flags
- [ ] README explicitly documents where machine-readable error payloads appear
- [ ] `purvey context` explicitly documents the machine-mode error contract
- [ ] Existing exit-code behavior is preserved exactly
- [ ] `auth status` keeps its existing special-case stdout JSON behavior unless explicitly changed in a separate plan

---

## Test Plan

### Process-boundary tests

Extend `tests/cli-output-modes.test.ts` with:

1. `catalog search --sort bogus --json`
   - expect `status === 2`
   - expect `stdout === ''`
   - parse `stderr` as JSON after stripping ANSI/newlines if needed
   - assert `{ error: true, code: 'INVALID_ARGUMENT' }`

2. `catalog search --sort bogus --pretty`
   - expect `status === 2`
   - strip ANSI, parse stderr JSON
   - assert the same code/message fields

3. Interactive human mode control
   - run through `script -e -q -c ...`
   - assert text error still contains `✖ Invalid --sort value`
   - assert stderr is not JSON in this mode

### Fixture tests

Extend `tests/exit-codes.test.ts` or add a new `tests/error-output.test.ts`:

4. `tests/fixtures/fatal-exit.ts DEPENDENCY_CONFLICT --json`
   - expect exit code 5
   - expect JSON stderr envelope with `code: 'DEPENDENCY_CONFLICT'`

5. `tests/fixtures/fatal-exit.ts AUTH_ERROR --json`
   - expect exit code 3
   - expect JSON stderr envelope with `code: 'AUTH_ERROR'`

6. Optional debug-path test
   - with `PURVEY_DEBUG=1`, verify `details` are included only in debug mode

---

## Risk Assessment

**Overall: Low-Medium.** The change is conceptually small, but it touches the public CLI contract.

### Main risks

1. **Existing scripts may scrape plain-text stderr**
   - Mitigation: only switch to JSON when structured output is explicitly requested or the command is non-interactive
   - Semver implication: treat this as a minor version bump, not a patch

2. **Success/error formatting drift could reappear**
   - Mitigation: extract one shared JSON formatter in `src/lib/output.ts` and reuse it from both paths

3. **`auth status` could get accidentally normalized into the new envelope**
   - Mitigation: explicitly exclude it from scope and preserve its current tests

4. **Commander-native errors will still be text-only**
   - Mitigation: document this as out of scope for this PR; revisit later with `exitOverride()` if needed

---

## Strategy Alignment Audit

- **Canonical direction:** This aligns directly with `repos/coffee-app/notes/PRODUCT_VISION.md` on API-first strategy and cross-surface consistency. The CLI is explicitly a first-class platform surface, not a sidecar utility. Stable machine-readable error payloads make the CLI more trustworthy for agents, scripts, and future API-adjacent consumers.
- **Strategic value:** The primary durable gain is **cross-surface consistency**. A clean CLI contract improves agent orchestration, shell composability, and developer confidence in Purveyors as an intelligence platform rather than a UI-only app. It also improves **public value legibility** for technical users evaluating the platform.
- **Why now:** Exit codes landed yesterday. That makes this the highest-leverage follow-up because it completes the machine contract across every command at once. It is strategically stronger than a one-off feature addition because it removes friction from all future agent and automation work.
- **Scope discipline:** This plan intentionally excludes broader output redesigns: no Commander `exitOverride()` work, no auth-status contract rewrite, no interactive prompt cleanup. The goal is a small, shippable process-boundary fix.
- **Tension / risk:** There is mild tension between improving machine contracts and preserving existing human stderr expectations. The right tradeoff is to change behavior only in structured/non-interactive modes, document the exception cases clearly, and version it as a minor observable contract change.

---

## Alternatives Considered

### 1. Convert the 2 remaining `process.exit(1)` calls in `roast.ts`

This is real cleanup, but it only affects TTY-only interactive paths. User impact is tiny compared to fixing every machine-facing fatal path.

### 2. Add a sales-record helper that resolves roast IDs from inventory + batch name

This would help a specific chat-agent workflow, but it is narrower, more product-surface-specific, and partially depends on coffee-app follow-up wiring. Lower breadth than the error-envelope fix.

### 3. Normalize `auth status` into the same error envelope contract

That would be more uniform, but it would also throw away a useful status-style command behavior and create unnecessary churn. Better to preserve the existing `auth status` contract for now and fix the generic fatal path first.

### 4. Selected: structured JSON error envelopes in machine modes

This is the best balance of:

- high user impact for agents and shell users
- cross-command breadth
- reasonable implementation size
- low product risk

It closes an already-documented gap instead of inventing new surface area.

---

## Open Questions

1. Should `--csv` also trigger JSON error envelopes? Recommendation: **yes**. CSV has no sensible error shape; JSON-on-stderr is the most parseable fallback.
2. Should non-interactive mode without explicit flags also emit JSON error envelopes? Recommendation: **yes**, to stay aligned with the documented default compact-JSON contract.
3. Should Commander-native parse errors eventually be normalized too? Probably yes, but only in a separate follow-up using `program.exitOverride()` so this plan stays small.
