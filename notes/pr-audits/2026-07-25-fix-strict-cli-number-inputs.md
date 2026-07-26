# Pre-submission audit: strict CLI numeric input

## Verdict

```text
VERDICT: ready
P0: 0
P1: 0
P2: 0
P3: 0
NEXT_ACTION: merge
CONFIDENCE: high
SCOPE_ASSESSMENT: mergeable
```

## Scope

Reject malformed or suffixed decimal input across inventory, roast, and sales
commands; isolate auth-status tests from host credentials; patch-bump the CLI
to `0.32.3`. Catalog proof and SDK behavior are intentionally excluded.

## Findings resolved before submission

- Configured form mode could bypass `roast create` numeric validation because
  the auto-form predicate incorrectly treated the defaultable roast date as
  required. Auto-form now depends only on the required coffee selector, and an
  isolated-HOME regression covers the malformed input path.
- Three auth-status tests inherited the developer machine's valid login. Each
  now runs with an isolated temporary HOME.

## Validation

- Full test suite: 594 passed.
- Build, typecheck, lint, contract, distribution, and prepublish parity gates
  passed.
- Focused strict-number and process-boundary tests passed after the final
  correction.
- `git diff --check` passed.
