# 2026-04-09 Implementation Plan — Normalize Commander Parse Errors into the CLI Error Contract

## Selected Improvement

Normalize Commander-native parse failures into the same machine-readable contract already used by `fatal()`. Specifically: `unknown option`, `unknown command`, and missing required argument errors should emit JSON error envelopes in machine-readable invocations and use `INVALID_ARGUMENT` exit code `2`, instead of falling back to Commander's plain-text stderr with exit code `1`.

## Problem Description With Evidence

The CLI's machine contract is still incomplete at the parser boundary.

### Evidence

1. **Commander parse failures still bypass the structured error contract.**

   Current behavior from repo main:

   ```bash
   $ pnpm exec tsx src/index.ts catalog search --bogus --json
   # exit 1
   # stdout: <empty>
   # stderr:
   error: unknown option '--bogus'
   ```

   ```bash
   $ pnpm exec tsx src/index.ts catlog --json
   # exit 1
   # stdout: <empty>
   # stderr:
   error: unknown command 'catlog'
   (Did you mean catalog?)
   ```

   ```bash
   $ pnpm exec tsx src/index.ts catalog get --json
   # exit 1
   # stdout: <empty>
   # stderr:
   error: missing required argument 'id'
   ```

   These are all invalid-argument cases, but they do not emit the documented JSON envelope and they do not use exit code `2`.

2. **The documented contract now over-promises.**

   `README.md` says:
   - `--json`, `--pretty`, or `--csv`: JSON error envelope on stderr
   - piped or redirected with no explicit flag: compact JSON error envelope on stderr

   `src/lib/manifest.ts` says structured errors are emitted when the invocation is non-interactive or when `--json`, `--pretty`, or `--csv` selects a machine-readable output mode.

   `tests/manifest.test.ts` asserts that same contract.

   That is true for errors that reach `fatal()`, but false for parse failures that Commander handles before command actions run.

3. **Recent contract work explicitly left this gap open.**

   `notes/implementation-plans/2026-04-07-json-error-envelopes.md` called out Commander-native parse/help errors as intentionally out of scope and named `exitOverride()` as the likely follow-up.

   `notes/pr-audits/2026-04-07-pr-79-json-error-envelopes.md` repeats that follow-up explicitly:
   - "Commander `exitOverride()` to normalize unknown-option/unknown-command errors into the same envelope"

4. **This breaks the exact agent-onboarding path the repo just improved.**

   `purvey context --json` now provides a machine-readable manifest contract, but the first typo in a real CLI call drops the caller back to unstructured Commander text. That undercuts the value of the manifest for agents, shell scripts, and downstream consumers trying to trust the CLI as a stable platform surface.

## Root Cause Analysis

There are currently **two separate process-boundary error paths**:

1. **Application / command-handler errors**
   - command actions use `withErrorHandling()`
   - `fatal()` maps them to structured envelopes and distinct exit codes

2. **Commander parser errors**
   - raised before command actions execute
   - currently handled by Commander's built-in exit/output path
   - never flow through `fatal()`

Because `src/program.ts` does not currently install a Commander `exitOverride()` strategy, parse failures exit early with Commander's default behavior:

- plain text stderr
- generic exit code `1`
- no JSON envelope
- no parity with `README`, `context`, or manifest docs

So the repo now has a clean error contract for business logic, but a leaky parser contract for the very first layer of the CLI.

## Proposed Fix

### 1. Intercept Commander exits centrally

Update the root program setup so Commander parse failures throw into the existing top-level `parseAsync(...).catch(...)` boundary instead of exiting directly.

Recommended mechanism:

- use `program.exitOverride()` in `src/program.ts`
- preserve normal zero-exit flows for `--help` and `--version`
- intercept non-zero parse/usage exits and route them into the CLI's own error boundary

### 2. Translate Commander errors into Purvey error semantics

Add a small adapter that maps Commander parse failures onto the CLI's existing error vocabulary.

Suggested mapping for v1:

- `unknown option` → `INVALID_ARGUMENT`
- `unknown command` → `INVALID_ARGUMENT`
- `missing required argument` → `INVALID_ARGUMENT`
- missing option argument / excess arguments / invalid option argument → `INVALID_ARGUMENT`
- unexpected Commander failures that do not fit the above → `GENERAL_ERROR`

This keeps the public contract simple and consistent with the existing exit-code model.

### 3. Reuse `fatal()` as the single formatter

Do **not** introduce a second structured-output formatter for Commander. Once mapped, Commander-originated errors should flow through `fatal()` so the repo keeps one source of truth for:

- JSON envelope shape
- pretty JSON behavior
- TTY-aware human-readable mode
- exit code mapping
- `PURVEY_DEBUG` handling

### 4. Avoid double-printing

The implementation must prevent the current Commander stderr text from being emitted before `fatal()` writes its own output.

That means the chosen `exitOverride()` / Commander output-hook approach must ensure machine-mode parse failures produce **one** stderr payload only.

### 5. Update the documented machine contract

Once parse failures are normalized, update docs and manifest wording so the promise becomes fully true.

Add or update:

- README fatal-error section
- `purvey context` human-readable text
- manifest error patterns / guidance

The docs should explicitly call out that parser-level mistakes now follow the same JSON envelope contract as runtime command failures.

### 6. Add regression coverage at the real CLI boundary

This work needs subprocess tests, not just helper tests, because the bug exists at the Commander process boundary.

## Specific Files To Change

1. **`src/program.ts`**
   - install Commander exit interception
   - ensure help/version flows still behave normally
   - prevent duplicate parse-error writes

2. **`src/index.ts`**
   - preserve the single top-level catch path
   - if needed, distinguish normal Commander help/version exits from real failures

3. **`src/lib/errors.ts`**
   - add Commander-error mapping helper or shared conversion logic
   - keep `fatal()` as the only formatter / exit-code writer

4. **Optional new helper:** `src/lib/commander-errors.ts`
   - if cleaner, isolate Commander-specific mapping logic here rather than bloating `errors.ts`

5. **`src/lib/manifest.ts`**
   - update error-pattern guidance and structured-error wording now that parser failures are covered too

6. **`README.md`**
   - make the fatal-error contract fully accurate for parse failures

7. **`tests/exit-codes.test.ts`**
   - add non-interactive parse-boundary assertions for unknown option, unknown command, and missing required argument

8. **`tests/cli-output-modes.test.ts`**
   - add TTY-mode coverage proving parse errors stay human-readable with no explicit output flag
   - add a machine-mode test if needed for redirected stderr

9. **`tests/manifest.test.ts`**
   - update contract assertions if wording changes

10. **`package.json`**

- minor version bump; this is an observable contract improvement for scripts and agents

## Pattern Scope

This is a shared process-boundary pattern, not a one-off command fix.

Components that share the pattern and should stay aligned:

- root Commander program setup in `src/program.ts`
- top-level catch boundary in `src/index.ts`
- shared error contract in `src/lib/errors.ts`
- human-readable agent reference from `purvey context`
- machine-readable manifest from `purvey context --json`
- README scripting contract
- every command group indirectly, because parser errors happen before any specific command handler runs:
  - `auth`
  - `catalog`
  - `inventory`
  - `roast`
  - `sales`
  - `tasting`
  - `config`
  - `context`

## Acceptance Criteria

- `pnpm exec tsx src/index.ts catalog search --bogus --json` exits `2`, writes no stdout, and writes a parseable JSON error envelope to stderr with `code: "INVALID_ARGUMENT"`
- `pnpm exec tsx src/index.ts catlog --json` exits `2` with the same envelope shape on stderr
- `pnpm exec tsx src/index.ts catalog get --json` exits `2` with the same envelope shape on stderr
- In an interactive TTY with no explicit output flag, those same parse failures remain human-readable rather than raw JSON
- `--help` and `--version` still exit `0` and do not get wrapped as errors
- README, `purvey context`, and manifest contract language all match the real behavior
- Existing runtime-error behavior from `fatal()` remains unchanged
- No parse failure produces duplicate stderr output

## Test Plan

### Process-boundary CLI tests

Extend `tests/exit-codes.test.ts` with:

1. **Unknown option**
   - run `catalog search --bogus --json`
   - assert `status === 2`
   - assert `stdout === ''`
   - parse stderr JSON
   - assert `error: true`, `code: 'INVALID_ARGUMENT'`, `exitCode: 2`

2. **Unknown command**
   - run `catlog --json`
   - assert same envelope shape and exit code

3. **Missing required argument**
   - run `catalog get --json`
   - assert same envelope shape and exit code

4. **Optional extra coverage**
   - missing option value / excess args / invalid argument parser cases if implementation touches them

### TTY / human-mode tests

Extend `tests/cli-output-modes.test.ts` with:

5. **TTY unknown option without explicit flag**
   - run through `script -e -q -c ...`
   - assert human-readable stderr
   - assert output does not contain JSON envelope fields

6. **TTY unknown command without explicit flag**
   - same pattern

7. **TTY missing required argument without explicit flag**
   - same pattern

### Contract/docs tests

8. **Manifest / context parity**
   - if manifest wording changes, update `tests/manifest.test.ts` to assert the new fully accurate language

9. **Help/version smoke**
   - verify `--help` and `--version` still exit cleanly and do not produce JSON error envelopes

## Risk Assessment

**Risk: Low-Medium**

### Main risks

1. **Double-printing parse errors**
   - Commander may emit its own error text before the CLI writes the JSON envelope
   - Mitigation: central interception must suppress default error output for handled failure paths

2. **Accidentally wrapping help/version as failures**
   - `exitOverride()` changes Commander exit behavior broadly
   - Mitigation: explicitly special-case zero-exit informational flows and add smoke tests

3. **Incomplete Commander error-code mapping**
   - different parse failures may surface via different Commander codes
   - Mitigation: cover the common cases first and fall back safely to `GENERAL_ERROR` only when truly unknown

4. **Subtle TTY regressions**
   - human terminal UX could degrade if parser failures always become JSON
   - Mitigation: preserve the existing TTY-no-flag behavior and test it explicitly

## Strategy Alignment Audit

- **Canonical direction:** This aligns directly with `repos/coffee-app/notes/PRODUCT_VISION.md` and ADR-001's CLI-as-source-of-truth direction. Purveyors wants one trustworthy platform surface across web, CLI, API, and agent workflows. A parser hole in the CLI contract weakens that strategy.
- **Strategic value:** The durable gain is **cross-surface consistency**. Agents, shell users, docs, and future downstream integrations can trust the CLI boundary even when a call is malformed. That improves developer trust and makes the product's intelligence layer more composable.
- **Why now:** Recent work already shipped distinct exit codes, JSON error envelopes, and a machine-readable manifest. That makes the remaining Commander parse gap more visible and more damaging than it was before. This is the smallest follow-up that makes the whole contract actually true.
- **Scope discipline:** This plan intentionally excludes new business features, publish automation, coffee-app migration work, and broader docs-site changes. It only closes the parser-boundary contract gap.
- **Tension / risk:** The only real strategic tension is preserving friendly terminal UX while hardening machine semantics. The right tradeoff is dual-mode behavior: human-readable in interactive no-flag usage, strict JSON envelopes in machine-readable invocations.

## Alternatives Considered

1. **Add a sales-record helper that accepts inventory ID + batch name**
   - Evidence: `repos/coffee-app/src/lib/services/tools.ts` still notes that `record_sale` cannot map cleanly to the CLI because the CLI expects `roast_id` while chat action cards currently work from inventory context plus `batch_name`.
   - Why not now: good flywheel potential, but it is narrower, touches a more specific product workflow, and still depends on follow-up wiring in coffee-app.

2. **Add stale-install / version-skew warnings**
   - Evidence: repo `package.json` is `0.12.0`, npm latest is `0.9.6`, and the globally installed `purvey` here is `0.9.3`.
   - Why not now: this is a real onboarding pain, but it treats the distribution symptom rather than the core CLI contract hole inside the repo itself.

3. **Update coffee-app comments and stale filter assumptions only**
   - Evidence: `tools.ts` still contains stale comments about client-side filters and a missing roast-update equivalent.
   - Why not now: valuable cleanup, but mostly downstream and documentation-oriented. It does not strengthen the CLI boundary itself.

4. **Selected: normalize Commander parse errors into the existing contract**
   - Best balance of user impact, flywheel effect, implementation size, and low risk.
   - Completes a documented cross-cutting platform contract rather than adding a one-off feature.

## Open Questions

1. Which exact Commander error codes should v1 normalize explicitly: only unknown option / unknown command / missing argument, or also excess arguments and missing option values?
2. Should the JSON envelope expose the raw Commander error code under `details` only when `PURVEY_DEBUG=1`?
3. Should parser failures ever include usage/help text in machine mode, or should the envelope stay intentionally minimal and rely on `message` plus docs/context?
4. Is a minor version bump sufficient, or does this contract hardening deserve stronger release-note emphasis because it changes machine-observable behavior from exit `1` to exit `2`?
