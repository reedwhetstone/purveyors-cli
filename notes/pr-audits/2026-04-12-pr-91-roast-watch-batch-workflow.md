# PR Verification Report

## Metadata

- Repo: `/root/.openclaw/workspace/worktrees/purveyors-cli-roast-watch-audit`
- Base: `origin/main`
- Head: `fix/roast-watch-audit`
- PR #: 91
- Reviewer model: `openai-codex/gpt-5.4` (workspace default subagent route)
- Confidence: Medium
- Scope note:
  - Reviewed `/tmp/verify-pr-pr91/metadata.txt`, `changed_files.txt`, `diffstat.txt`, `commits.txt`, `full.diff`, and `pr.json`.
  - `pr.json` was empty, so there was no canonical PR body beyond the task intent.
  - `notes/PRODUCT_VISION.md` was not present in this repo. The available ADRs in `notes/decisions/` were not directly relevant to roast-watch behavior.
  - I inspected the changed files in repo context and ran repo checks: `pnpm test` ✅, `pnpm check` ✅, `pnpm prepack` ✅, `pnpm lint` ❌.

## Executive Verdict

- Merge readiness: Not ready
- Intent coverage: Partial
- Priority summary: P0: 0, P1: 1, P2: 3, P3: 0

## Intent Verification

- Stated intent:
  - Make `roast watch` support a real batch workflow instead of importing each file immediately.
  - Add watch-time metadata inputs for green weight, roast targets, and roast notes.
  - Preserve queued state across resume.
  - Harden shutdown behavior.
  - Keep docs/tests aligned.
  - Keep release readiness coherent after bumping to `0.14.1`.
- What was implemented:
  - `roast watch` now accepts `--commit-mode <batch|individual>` and defaults to batch in new sessions.
  - Watch sessions persist `commitMode`, `ozIn`, `roastNotes`, `roastTargets`, and queued `pending` records.
  - Resume rehydrates pending records into an in-memory queue.
  - Shutdown now drains active tasks, then commits queued imports in batch mode.
  - `roast_targets` was threaded into `importRoastFromFile`, roast selects, manifest, and README/watch help.
  - `package.json` was bumped to `0.14.1`.
- Coverage gaps:
  - Shutdown hardening is incomplete under repeated termination signals.
  - The prescribed manual fallback path for `needs-review` files cannot preserve the newly added `roastTargets` metadata.
  - Tests do not directly cover the new batch/resume/shutdown behavior.
  - The branch is not lint-clean (`pnpm lint` fails on the modified `watch.ts`).

## Findings by Severity

### P0 (must fix before merge)

- None.

### P1 (should fix before merge)

- **Title:** Repeated Ctrl+C/SIGTERM can interrupt the new batch-finalization path mid-import
- **Evidence:**
  - `src/lib/interactive/watch.ts:598-610` sets `shuttingDown = true`, closes the watcher, and removes both signal listeners before awaiting active tasks and before the queued commit loop.
  - `src/lib/interactive/watch.ts:618-624` then performs the batch commit loop asynchronously.
  - `src/lib/roast.ts:572-603` shows that `importRoastFromFile()` inserts a `roast_profiles` row before running the full Artisan import.
- **Impact:**
  - If the user presses Ctrl+C again while queued roasts are being finalized, Node falls back to default signal behavior because the handlers were already removed.
  - That can terminate the process during a write path, which is the opposite of “harden shutdown behavior”.
  - Because the import writes the roast row before completing the full import, an interrupted shutdown can leave partial queue drainage and potentially partially written roast data.
- **Correction:**
  - Keep shutdown handlers installed until all drain/commit work finishes, or replace them with an idempotent “shutdown in progress” handler.
  - Only unregister listeners after the queue is fully settled.
  - Add a regression test that simulates a second signal during batch finalization.

### P2 (important improvements)

- **Title:** The documented manual fallback path drops the new `roastTargets` metadata
- **Evidence:**
  - Watch mode accepts `--roast-targets` in `src/commands/roast.ts:651-654` and persists it into imports via `src/lib/interactive/watch.ts:397-399`.
  - When auto-match needs manual review, shutdown tells the user to run `purvey roast import <file> --coffee-id <id>` in `src/lib/interactive/watch.ts:629-640`.
  - But `roast import` only exposes `--oz-in` and `--roast-notes`, not `--roast-targets`, in `src/commands/roast.ts:447-451` and `src/commands/roast.ts:609-617`.
  - README import docs also omit `--roast-targets` at `README.md:323-329`.
- **Impact:**
  - One of the new watch-time metadata fields cannot be carried through the product’s own manual-recovery path.
  - Intent coverage is therefore partial for low-confidence auto-match / manual resolution cases.
- **Correction:**
  - Add `--roast-targets` to `roast import` flag mode, form mode, manifest, and README, or change the recovery flow so manual review remains inside the watch session instead of bouncing to `roast import`.

- **Title:** Core batch/resume/shutdown behavior is largely untested
- **Evidence:**
  - `tests/watch.test.ts` covers helper functions, JSON round-trips, debounce snippets, and verification-table rendering only.
  - The new assertions added by this PR are limited to queued-count summary output (`tests/watch.test.ts:362-392`).
  - There are no direct tests for `startWatch()` queueing behavior, resume of pending records, propagation of `ozIn` / `roastNotes` / `roastTargets`, or SIGINT/SIGTERM drain semantics.
- **Impact:**
  - The highest-risk behavior added by the PR is the least verified.
  - Regressions in batch queueing, resume, or shutdown can ship while the test suite still passes.
- **Correction:**
  - Add mocked `startWatch()` tests that cover:
    1. batch vs individual commit modes,
    2. resume with pending queued records,
    3. metadata propagation into `importRoastFromFile()`,
    4. shutdown while active tasks exist,
    5. repeated-signal behavior.

- **Title:** The branch is not lint-clean
- **Evidence:**
  - `pnpm lint` failed with Prettier reporting `src/lib/interactive/watch.ts` as not formatted.
  - `pnpm test`, `pnpm check`, and `pnpm prepack` all passed.
- **Impact:**
  - If lint is enforced in CI or pre-merge workflow, this branch is not merge-ready as-is.
  - Even if CI does not block on it, the repo’s stated quality gate is currently red on the changed file.
- **Correction:**
  - Format `src/lib/interactive/watch.ts` and rerun `pnpm lint`.

### P3 (nice to have)

- None.

## Assumptions Review

- Assumption: Users will send only one termination signal during shutdown.
- Validity: Invalid
- Why:
  - The code explicitly removes the signal listeners before async queue finalization completes.
  - Repeated Ctrl+C during long shutdowns is common CLI behavior.
- Recommended action:
  - Make repeated signals idempotent and user-visible instead of reverting to default termination.

- Assumption: The manual `roast import` fallback path is sufficient for files that need review after watch-mode auto-match.
- Validity: Weak
- Why:
  - That path cannot currently accept `roastTargets`, one of the new metadata fields added by this PR.
- Recommended action:
  - Bring `roast import` to feature parity for the metadata fields used by watch mode, or change the recovery UX.

- Assumption: Helper/table tests are enough to validate the new watch workflow.
- Validity: Invalid
- Why:
  - The risky logic lives in `startWatch()` state transitions and shutdown behavior, not in table rendering.
- Recommended action:
  - Add direct tests around queueing, resume, and signal-driven shutdown.

## Tech Debt Notes

- Debt introduced:
  - `src/lib/interactive/watch.ts` now owns queue state, resume hydration, signal handling, and commit orchestration in one file/function, increasing behavioral surface area.
- Debt worsened:
  - Test coverage still skews toward helpers and presentation instead of the watch state machine.
- Suggested follow-up tickets:
  - Extract shutdown/queue orchestration into smaller units with direct tests.
  - Add a dedicated watch-session state-machine test suite.

## Product Alignment Notes

- Alignment wins:
  - The PR materially improves the core watch workflow: batch queueing is now real, queued state is persisted, and watch-time metadata is threaded through the main import path.
  - CLI help, manifest, and README watch docs were updated for the new options.
  - The `0.14.1` version bump is coherent with the scope of the change, and `pnpm prepack` passed.
- Misalignments:
  - “Harden shutdown behavior” is not fully met because repeated termination can still break finalization.
  - Manual recovery for watch-mode review cases does not preserve all new metadata fields.
- Suggested product checks:
  - Decide whether “needs review” should remain inside `roast watch` instead of ejecting users to `roast import`.
  - Confirm desired UX for interrupting a long batch finalization.

## Test Coverage Assessment

- Existing tests that validate changes:
  - `tests/roast-import.test.ts` confirms `importRoastSchema` accepts `roastTargets`.
  - `tests/watch.test.ts` confirms queued counts render in the verification table.
  - Full repo checks passed: `pnpm test`, `pnpm check`, `pnpm prepack`.
- Missing tests:
  - Batch queueing vs individual mode import timing.
  - Resume of pending queued records.
  - Persistence/rehydration of `commitMode`, `selectedCoffeeId`, `selectedCoffeeName`, and watch-time metadata.
  - Shutdown while active tasks are in flight.
  - Repeated-signal behavior during batch finalization.
- Suggested test additions:
  - Mock `fs.watch`, `importRoastFromFile`, and Supabase to drive `startWatch()` through new state transitions.
  - Add a regression test for second Ctrl+C during queued-commit finalization.

## Minimal Correction Plan

1. Make shutdown idempotent across repeated signals and keep signal handling active until queued finalization completes.
2. Add `roastTargets` support to the `roast import` recovery path, plus corresponding manifest/README/help updates.
3. Add direct tests for batch mode, resume of pending imports, metadata propagation, and shutdown behavior.
4. Run Prettier on `src/lib/interactive/watch.ts` and re-run `pnpm lint`.

## Optional Patch Guidance

- `src/lib/interactive/watch.ts`
  - Keep a shutdown listener installed during the entire drain/commit phase.
  - Replace listener removal with a guard that reports “shutdown already in progress”.
  - Add a test seam or helper for queue-finalization logic.
- `src/commands/roast.ts`
  - Extend `roast import` with `--roast-targets` in both flag and form modes.
- `src/lib/manifest.ts`
  - Add the corresponding import-command option if `roast import` is extended.
- `README.md`
  - Document `--roast-targets` on `roast import` if added, and keep manual recovery guidance aligned.
- `tests/watch.test.ts`
  - Add behavioral tests around `startWatch()` rather than only formatting/summary tests.

## Checklist Appendix

- 1. Intent Coverage: CONCERN
- 2. Correctness: FAIL
- 3. Codebase Alignment: CONCERN
- 4. Risk and Regressions: CONCERN
- 5. Security and Data Safety: PASS
- 6. Test and Verification Quality: FAIL
- 7. Tech Debt and Maintainability: CONCERN
- 8. Product and UX Alignment: CONCERN
- 9. Assumptions Audit: FAIL
- 10. Final Verdict: Not ready
