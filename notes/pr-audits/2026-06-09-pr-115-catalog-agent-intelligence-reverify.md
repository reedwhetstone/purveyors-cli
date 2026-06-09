# PR #115 Reverification: Catalog Agent Intelligence

**Date:** 2026-06-09  
**Repository:** `purveyors-cli`  
**PR:** https://github.com/reedwhetstone/purveyors-cli/pull/115  
**Base:** `origin/main`  
**Head:** `feat/catalog-agent-intelligence` at `864af41`  
**Verdict:** `ready`  
**Scope assessment:** `mergeable`

## Operator summary

```text
VERDICT: ready
P0: 0
P1: 0
P2: 0
P3: 0
NEXT_ACTION: merge
TOP_FIXES:
- No required fixes remain.
- Prior pre-auth malformed-flag validation issue is fixed.
- Prior supplier sampling and metadata transparency issues are fixed.
CONFIDENCE: high
SCOPE_ASSESSMENT: mergeable
VALIDATION_STATUS:
- local implementation validation: VALIDATION_PASS
- GitHub CI: VALIDATION_PASS
```

## Validation evidence

- `pnpm check && pnpm build && pnpm exec vitest run tests/catalog.test.ts tests/cli-output-modes.test.ts --maxWorkers=1 --minWorkers=1`: `VALIDATION_PASS`, 121 targeted tests passed after typecheck and build.
- `pnpm exec tsx src/index.ts catalog rank-premium --limit nope --json`: `VALIDATION_PASS`, exited `2` with JSON `INVALID_ARGUMENT` before auth.
- `GH_TOKEN=... gh pr checks 115 --repo reedwhetstone/purveyors-cli`: `VALIDATION_PASS`; GitGuardian and `Lint, Type Check, Prepublish Parity, Test` passed on run https://github.com/reedwhetstone/purveyors-cli/actions/runs/27182374871.
- Known post-patch validation from the parent task also reports full `pnpm exec vitest run --maxWorkers=1 --minWorkers=1` passed 25 files / 574 tests after the unrelated parallel TTY/temp flake.

## Prior findings status

### Fixed: malformed new-command flags validate before auth

The new catalog intelligence command actions now construct and validate their `input` objects before calling `requireAuth('viewer')`:

- `catalog rank-premium`: parses `--price-max`, `--min-score`, `--sample-size`, and `--limit` before auth.
- `catalog supplier-list`: parses `--sample-size` and `--limit` before auth.
- `catalog supplier-detail`: parses `--top-coffees` and `--sample-size` before auth.
- `catalog supplier-rank`: parses `--min-coffees`, `--sample-size`, and `--limit` before auth.

`tests/catalog.test.ts` now has a parameterized regression test asserting malformed flags return `INVALID_ARGUMENT` and `requireAuth` is not called. A direct CLI smoke test confirmed the behavior outside the mocked unit-test path.

### Fixed: supplier aggregate sampling bias

`src/lib/catalog.ts` now uses `fetchSupplierAggregateRows`, which paginates supplier aggregate rows in `sampleSize` pages instead of taking one source-ordered slice and aggregating only that slice. The regression test with `sampleSize: 2` confirms a later `Zulu Coffee` supplier is included after pagination rather than being omitted by the first page.

This resolves the original alphabetical-bias concern for the current slice. One non-blocking future hardening idea: if a deployed Supabase/PostgREST row cap is ever configured below the requested page size, pagination should detect the effective cap or use a conservative page size. That is not a confirmed defect in this PR and is not a merge blocker.

### Fixed: sampling and truncation metadata transparency

The output contracts now expose the needed agent-facing metadata:

- `CatalogPremiumRanking.meta.sample_limited`
- `CatalogPremiumRanking.meta.sample_order`
- `CatalogPremiumRanking.meta.truncated`
- `SupplierAggregateResponse.meta.sample_limited`
- `SupplierAggregateResponse.meta.sample_order`
- `SupplierAggregateResponse.meta.truncated`
- `SupplierAggregateResponse.meta.rows_examined`

README and manifest notes also document that premium rankings are score-ordered samples while supplier aggregates paginate rows and report rows examined. This is enough for agents to distinguish ranked samples from full aggregate reads.

## Scope and product alignment

The PR remains independently mergeable if later planned catalog-intelligence slices never ship. It delivers the PR 1 acceptance criteria from `notes/implementation-plans/2026-06-09-catalog-agent-intelligence.md`:

- Exported reusable functions are available from `src/lib/catalog.ts`, with `src/lib/index.ts` re-exporting catalog functions for `@purveyors/cli/lib` and package subpath export `./catalog` serving `@purveyors/cli/catalog` after build.
- CLI commands call library functions rather than duplicating aggregation logic.
- `catalogRankPremium` returns ranked coffees with rank, catalog context, pricing, stocked status, `purveyor_score`, and transparent signals.
- Supplier functions return row counts, stocked counts, score coverage, average score, price range, origin/process coverage, and representative top coffees.
- README, manifest metadata, top-level help, and repo-local AGENTS guidance are aligned with the new command surface.

This matches the coffee-app product vision: the CLI is treated as an agent-first product surface, score provenance is explicit, and the implementation improves green-coffee decision quality without inventing a parallel score model or backend endpoint.

## New regression / scope-creep check

No merge-blocking regression or weird scope creep found.

- The package version bump to `0.19.0` is appropriate for a new command/function surface.
- `AGENTS.md` changes are repo-local contributor guidance and accurately reflect the command/auth surface.
- The docs expansion is proportional to the new agent-facing feature area.
- No data writes, migrations, auth-role escalation beyond viewer reads, or unrelated product behavior changes were introduced.

## Recommendation

Merge PR #115 after normal operator review. No same-PR patch is required.
