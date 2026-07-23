# Pre-submission audit: watched roast matching and form recovery

## Verdict

```text
VERDICT: ready
P0: 0
P1: 0
P2: 0
P3: 0
NEXT_ACTION: merge
TOP_FIXES:
- None.
CONFIDENCE: high
SCOPE_ASSESSMENT: right-sized
VALIDATION_STATUS: pass
```

## Scope reviewed

- Exact-token supplier matching against stocked inventory before the AI fallback
- Ambiguous-supplier behavior and inventory-ID confinement
- Continued `--form` recovery through the existing stocked-inventory picker
- Session persistence, cancellation fallback, metadata preservation, and patch release bump

## Adversarial review

The deterministic matcher requires every meaningful supplier token to appear as a complete filename token and requires exactly one matching stocked inventory row. It cannot return an ID outside the fetched owner inventory; multiple stocked rows from the supplier retain the existing AI/review path. Generic supplier terms are excluded so `coffee`, `green`, or `roasters` alone cannot cause a match.

Interactive recovery runs only for sessions explicitly started through `--form` (or resumed from one), uses the existing `stocked_only` picker, preserves the original file, batch, weight, notes, and targets, and retains the manual command when selection is cancelled or fails. Flag-driven automation is unchanged.

Fresh-context subagent review was unavailable because the active runtime policy prohibited spawning subagents for this turn. The parent performed the adversarial checklist directly against the committed diff and focused behavior tests.

## Validation evidence

- `pnpm exec vitest run tests/watch-start.test.ts`: 15 passed
- Isolated-home `pnpm test`: 578 passed
- `pnpm check`: passed
- `pnpm lint`: passed
- Isolated-home `pnpm verify:prepublish`: passed, including build, contract, dist, package, and parity checks
- `git diff --check`: passed

The first non-isolated full test invocation found three auth-status expectation failures because this host has a valid global Purvey credential. Re-running with an isolated home directory passed all 578 tests; no product-code failure was involved.
