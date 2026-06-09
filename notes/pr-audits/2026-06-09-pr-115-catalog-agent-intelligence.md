# PR #115 Verification: Catalog Agent Intelligence

**Date:** 2026-06-09  
**Repository:** `purveyors-cli`  
**PR:** https://github.com/reedwhetstone/purveyors-cli/pull/115  
**Base:** `origin/main`  
**Head:** `feat/catalog-agent-intelligence`  
**Verdict:** `fail`  
**Scope assessment:** `mergeable_with_followups`

## Operator summary

```text
VERDICT: fail
P0: 0
P1: 1
P2: 0
P3: 0
NEXT_ACTION: patch_same_pr
TOP_FIXES:
- Fix the new malformed-flag tests in `tests/catalog.test.ts`; they assert raw unescaped quote substrings against JSON-escaped stderr.
- Re-run `pnpm test tests/catalog.test.ts tests/cli-output-modes.test.ts && pnpm check && pnpm build` after the test fix.
- Commit and push the current local fixes before relying on this verdict; the pushed PR head and current worktree diverged during review.
CONFIDENCE: high
SCOPE_ASSESSMENT: mergeable_with_followups
VALIDATION_STATUS:
- `pnpm check && pnpm build && pnpm test`: VALIDATION_PASS, ran before concurrent local fix patches arrived
- `pnpm verify:prepublish`: VALIDATION_PASS, ran before the final malformed-flag test additions failed
- `pnpm test tests/catalog.test.ts tests/cli-output-modes.test.ts && pnpm check && pnpm build`: VALIDATION_FAIL, `tests/catalog.test.ts` malformed-flag assertions fail
- `pnpm lint`: VALIDATION_PASS after formatting this audit report
- `pnpm exec tsx src/index.ts catalog rank-premium --limit nope --json`: VALIDATION_PASS, now returns `INVALID_ARGUMENT` before auth
- `pnpm exec tsx src/index.ts catalog rank-premium --stocked --limit 3 --json`: VALIDATION_BLOCKED_ENV, no logged-in Purveyors session in this execution context
- `GH_TOKEN=... gh pr checks 115 --repo reedwhetstone/purveyors-cli`: VALIDATION_CI_PENDING, GitGuardian reported pending at audit time
```

## Important review-state note

The worktree changed while this audit was running. The initial pushed PR head had two implementation-quality issues: supplier aggregate sampling bias and post-auth malformed-argument validation. The current local worktree appears to patch both issues, but it is not clean and not fully validated:

- Modified locally: `README.md`, `src/commands/catalog.ts`, `src/lib/catalog.ts`, `src/lib/manifest.ts`, `tests/catalog.test.ts`
- Untracked: `notes/pr-audits/2026-06-09-pr-115-catalog-agent-intelligence.md`

This report's final verdict is for the current local worktree, not only the originally generated artifacts. The current worktree is not merge-ready because targeted tests fail.

## Intent coverage

The slice is conceptually sound and independently useful once tests are fixed.

What the PR does well:

- Adds reusable catalog intelligence functions in `src/lib/catalog.ts`: `catalogRankPremium`, `supplierList`, `supplierDetail`, `supplierRank`, plus pure helpers for score summaries, premium ranking, and supplier aggregates.
- Keeps CLI wrappers in `src/commands/catalog.ts` thin; they parse flags and delegate to library functions.
- Exposes existing `coffee_catalog.score_value` as `purveyor_score` instead of recomputing or inventing a local opaque score.
- Updates README, the command manifest, and top-level help so agents can discover the new surface.
- Adds tests for score bands, premium ranking, supplier aggregates, library wrappers, supplier pagination, sample metadata, and malformed new-command flags.
- Bumps the package to `0.19.0`, appropriate for a new exported feature surface.

Product alignment is strong. This advances the PRODUCT_VISION direction that the CLI is a core agent-first product surface and that green coffee supply-chain intelligence should improve decision quality across CLI, web, API, and agent consumers.

## Findings

### P1-1: Current local test suite fails after the malformed-flag test additions

**Evidence**

Command run:

```bash
pnpm test tests/catalog.test.ts tests/cli-output-modes.test.ts && pnpm check && pnpm build
```

Result: `VALIDATION_FAIL`.

The failures are in `tests/catalog.test.ts`, in the parameterized test named:

```text
catalog command auth and structured filter parsing > rejects malformed new catalog intelligence flags before auth
```

The test currently checks raw stderr text with:

```ts
expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(message);
```

The expected `message` strings include unescaped quotes, for example:

```text
Invalid --top-coffees: "26"
Invalid --min-coffees: "none"
```

But stderr is a JSON error envelope, so the embedded quotes are escaped:

```json
{
  "error": true,
  "code": "INVALID_ARGUMENT",
  "exitCode": 2,
  "message": "Invalid --top-coffees: \"26\". Must be between 1 and 25."
}
```

That causes the substring assertion to fail even though the command behavior is correct. A direct smoke test confirms the fix itself works:

```bash
pnpm exec tsx src/index.ts catalog rank-premium --limit nope --json
```

returns `INVALID_ARGUMENT` with exit code `2` before auth.

**Why it matters**

The branch cannot be considered merge-ready while the targeted test suite fails. This is a test assertion bug, not a product-slice boundary problem, but it is still a merge blocker.

**Fix guidance**

Parse the stderr JSON before asserting the message, matching the actual machine contract:

```ts
const payload = JSON.parse(String(stderrSpy.mock.calls[0]?.[0]));
expect(payload.code).toBe('INVALID_ARGUMENT');
expect(payload.message).toContain(message);
```

Alternatively, assert on escaped JSON substrings, but parsing is cleaner and more aligned with agent-facing behavior.

## Resolved concerns in the current local worktree

### Supplier aggregate sampling bias appears fixed locally

The initial committed implementation made supplier aggregates alphabetically biased: supplier commands ordered rows by `source ASC`, applied one `range(0, sampleSize - 1)`, and defaulted to 1000 rows. With a catalog known to exceed 1000 rows in workspace context, later suppliers could be omitted from `supplier-list` and `supplier-rank`.

The current local worktree adds `fetchSupplierAggregateRows` pagination in `src/lib/catalog.ts`, defaults supplier aggregate page size to the 5000-row cap, and adds a regression test proving a later `Zulu Coffee` supplier is not omitted. That resolves the product concern if committed and pushed.

### Pre-auth validation appears fixed locally

The current local worktree moves parsing for new catalog-intelligence command options before `requireAuth('viewer')` and adds bounded parsing for documented maxima. Direct smoke testing confirms malformed `rank-premium --limit nope --json` now returns `INVALID_ARGUMENT` before auth.

### Sampling metadata appears improved locally

The current local worktree adds structured metadata for sample behavior:

- `CatalogPremiumRanking.meta.sample_limited`
- `CatalogPremiumRanking.meta.sample_order`
- `CatalogPremiumRanking.meta.truncated`
- `SupplierAggregateResponse.meta.rows_examined`
- `SupplierAggregateResponse.meta.sample_order`

That addresses the earlier agent-trust concern around sampled or paginated results.

## Checklist audit

- **Intent coverage:** Complete in concept. The PR exposes score-based ranking and supplier intelligence through reusable library functions and CLI commands.
- **Independent mergeability:** Not merge-ready until the current failing tests are fixed, but the slice boundary is still valid.
- **Product alignment:** Strong. It improves shared agent-first decision quality and avoids invented backend endpoints.
- **Source-of-truth discipline:** Good. Core logic lives in `src/lib/catalog.ts`; command wrappers delegate.
- **Transparency:** Good on score provenance; `purveyor_score.source` is `score_value`, and caveats state the CLI does not recompute the score model.
- **Machine contract:** Good in current local code; malformed flags now return `INVALID_ARGUMENT` before auth.
- **Tests:** Good coverage direction, but current assertions fail against JSON-escaped stderr.
- **Validation:** Local targeted validation fails. Lint passes. Live read-only command smoke was blocked by missing Purveyors login, not by code behavior.

## Recommended next action

Patch the same PR:

1. Fix `tests/catalog.test.ts` malformed-flag assertions by parsing stderr JSON before checking `payload.message`.
2. Re-run `pnpm test tests/catalog.test.ts tests/cli-output-modes.test.ts && pnpm check && pnpm build`.
3. Run the broader merge gate: `pnpm lint && pnpm verify:prepublish && pnpm test`.
4. Commit and push the local fixes, then wait for PR CI to complete.
