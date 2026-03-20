# PR Audit: fix/auth-status-tty-detection (PR #36)

**Date:** 2026-03-19
**Reviewer model:** anthropic/claude-opus-4-6
**Confidence:** High (small focused change, 3 files, +16/-9 lines)

## Executive Verdict

- **Merge readiness:** Ready (P1 fixed before report was finalized)
- **P0:** 0 | **P1:** 1 (fixed) | **P2:** 1 | **P3:** 2

## Intent Coverage

Stated intent: make `purvey auth status` output compact JSON when piped, keep human-readable for TTY, update agent reference, bump to 0.6.2.

All intent points covered. TTY detection logic is correct; agent context reference updated from v0.5 to v0.6; help text updated; version bumped.

## Findings

### P1 — Fixed (ora spinner polluting stdout when piped)

`ora` defaults to `process.stdout`. When piped, it writes a static spinner line before `spinner.stop()`, corrupting the JSON output even after the TTY detection fix.

**Fix applied:** All three ora instances in auth.ts now use `{ stream: process.stderr }`:

- `loginAction`: `ora({ text: 'Waiting for authentication...', stream: process.stderr })`
- `statusAction`: `ora({ text: 'Checking authentication status...', stream: process.stderr })`
- `headlessLoginAction`: `ora({ text: 'Validating session...', stream: process.stderr })`

This aligns spinners with the existing convention (success/info/warn already go to stderr).

### P2 — Deferred: no tests for TTY detection behavior

No auth command test file exists. The TTY-dependent branching (`statusAction`) is untested. A future test should mock `process.stdout.isTTY` and `validateSession` to verify:

1. TTY=true + no flags → interactive path (success/info)
2. TTY=undefined + no flags → outputData called (JSON)
3. TTY=true + `--pretty` → outputData called (JSON override)

Deferred as follow-up; not blocking merge.

### P3 — Agent reference version tracks minor, not patch

`purvey context` outputs `v0.6` while package is `0.6.2`. Minor confusion for agents. Convention undocumented. Low priority; acceptable as-is.

### P3 — `2>/dev/null` example self-resolved by P1 fix

Help text example `purvey auth status 2>/dev/null | jq .` was accurate only if spinners write to stderr. The P1 fix makes this example correct.

## Assumptions Verified

| Assumption                                                      | Valid?                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `process.stdout.isTTY` sufficient for non-interactive detection | Yes                                                     |
| `!opts.pretty && !opts.csv` captures all explicit format flags  | Yes                                                     |
| Other CLI commands don't have the ora-stdout problem            | Yes (they use outputData directly)                      |
| ora to stderr is the right fix                                  | Yes (aligns with existing success/info/warn convention) |

## Tech Debt Notes

- No new debt introduced
- Pre-existing ora-to-stdout issue now fixed for auth.ts
- Suggested follow-up: shared `createSpinner(text)` helper that enforces `stream: process.stderr` to prevent future regressions
