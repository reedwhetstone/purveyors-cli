# PR #103 Verification Audit: Structured Process Catalog Filters

**Date:** 2026-04-30
**Repo:** `reedwhetstone/purveyors-cli`
**PR:** https://github.com/reedwhetstone/purveyors-cli/pull/103
**Branch:** `feat/catalog-structured-process-filters`
**Commit reviewed:** `6a82aa3`
**Reviewer:** OpenClaw verify-pr subagent

## Operator summary

VERDICT: ready_with_fixes
P0: 0
P1: 1
P2: 1
P3: 0
NEXT_ACTION: patch_same_pr
CONFIDENCE: high
SCOPE_ASSESSMENT: mergeable

## Merge recommendation

Do not merge PR #103 as-is. The implementation correctly adds the requested structured process flags, maps them to the existing direct catalog query path, preserves legacy `--process`, updates README and manifest surfaces, and passes the provided validation suite. The slice boundary is still coherent, but it needs one same-PR access-control correction before merge.

The blocker is product and entitlement alignment: after ADR-005 and the merged coffee-app access-capability work, structured process facets are member or paid API search leverage. This PR exposes the same filters through `purvey catalog search` with only `requireAuth('viewer')`, and because the CLI currently queries Supabase directly rather than `/v1/catalog`, it bypasses the canonical server denial behavior for viewer sessions.

## What changed

Changed files from the collected artifacts:

- `README.md`
- `package.json`
- `src/commands/catalog.ts`
- `src/lib/catalog.ts`
- `src/lib/manifest.ts`
- `tests/catalog.test.ts`

The diff adds five catalog search flags:

- `--processing-base-method`
- `--fermentation-type`
- `--process-additive`
- `--processing-disclosure-level`
- `--processing-confidence-min`

It also adds `CatalogItem` process metadata fields, schema inputs, Supabase query filters, manifest/help docs, a minor version bump to `0.16.0`, and focused tests for schema acceptance, confidence bounds, and query mapping.

## Product context read

Sources reviewed:

- `coffee-app/notes/PRODUCT_VISION.md`
- `coffee-app/notes/decisions/004-processing-transparency-schema-api.md`
- `coffee-app/notes/decisions/005-catalog-access-level-positioning.md`
- `coffee-app/notes/decisions/002-api-first-external-internal-split.md`
- `coffee-app/notes/implementation-plans/2026-04-28-processing-transparency-discovery-funnel-pr-02-cli-structured-process-filters.md`
- `coffee-app/notes/implementation-plans/2026-04-29-cli-api-key-catalog-parity.md`
- `coffee-app` `origin/main:src/lib/server/catalogAccess.ts`
- `coffee-app` `origin/main:src/lib/server/catalogResource.ts`

Key product constraints:

- ADR-004 makes structured process fields additive and canonical while keeping `processing` as a backward-compatible label.
- ADR-005 separates data visibility from search leverage. Viewer access can inspect catalog data, but advanced process facets belong to member sessions or paid API tiers.
- `coffee-app` `origin/main` now has `resolveCatalogAccessCapabilities`, where `canUseProcessFacets` is true only for member session roles or paid API plans. `/v1/catalog` returns `401` or `403` when unauthorized callers request process facet params.
- The CLI still uses a direct Supabase session path for catalog reads, with API-key `/v1/catalog` parity planned separately.

## Findings

### P1: Structured process filters bypass the member or paid API process-facet gate

**Status:** confirmed product/access-control defect
**Files:** `src/commands/catalog.ts`, `README.md`, `src/lib/manifest.ts`
**Impact:** viewer-session CLI users can use advanced process facets that the canonical web/API contract now gates to members or paid API tiers.

Evidence:

- `src/commands/catalog.ts` still calls `requireAuth('viewer')` unconditionally before `searchCatalog(...)`.
- The new structured process options are forwarded directly into `searchCatalog(...)` after only viewer auth.
- `src/lib/catalog.ts` queries `supabase.from('coffee_catalog').select('*')` directly and applies `.eq(...)`, `.contains(...)`, and `.gte(...)` filters. It does not call `/v1/catalog`, so it does not inherit the server-side `canUseProcessFacets` denial logic.
- `README.md` says `Catalog commands require an authenticated viewer role` immediately after documenting the new structured process filters.
- `coffee-app` `origin/main:src/lib/server/catalogAccess.ts` grants `canUseProcessFacets` only to member session roles or paid API plans.
- `coffee-app` `origin/main:src/lib/server/catalogResource.ts` denies requested process facet params when `canUseProcessFacets` is false and returns `deniedParams` plus `requiredCapability: 'canUseProcessFacets'`.

Why this matters:

The CLI is a core machine surface, so it must not become the escape hatch around the canonical access contract. ADR-005 explicitly treats structured process facets as search leverage, not mere data visibility. The current PR makes that leverage available to any logged-in viewer through the direct Supabase path.

Required correction in this PR:

- In `src/commands/catalog.ts`, detect whether any structured process filter was requested:
  - `opts.processingBaseMethod`
  - `opts.fermentationType`
  - `opts.processAdditive`
  - `opts.processingDisclosureLevel`
  - `opts.processingConfidenceMin !== undefined`
- Use dynamic auth:
  - `requireAuth('member')` when any structured process filter is present.
  - `requireAuth('viewer')` for normal catalog search without process facets.
- Keep validation before auth so malformed `--processing-confidence-min`, `--sort`, and `--ids` still fail as argument errors instead of auth errors.
- Update `README.md`, help text, and `src/lib/manifest.ts` notes to say structured process filters require member access under the current session-authenticated CLI path.
- Add tests proving viewer-level catalog search remains available, but process-facet searches require member role.

Longer-term note, not required for this PR:

The planned CLI API-key catalog parity work should route catalog reads through `/v1/catalog` for API-key mode so API Green and paid API tiers inherit the canonical server contract. This PR can still be mergeable with dynamic member auth for session mode.

### P2: Test coverage does not exercise the actual command/auth boundary for the new flags

**Status:** confirmed coverage gap
**Files:** `tests/catalog.test.ts`, likely existing command or output-mode tests
**Impact:** current tests prove schema acceptance and Supabase query mapping, but not that Commander option parsing, auth selection, and action forwarding stay correct together.

Evidence:

- `tests/catalog.test.ts` adds `searchCatalogSchema` tests and a `searchCatalog(...)` query-mapping test.
- There is no new test that invokes `purvey catalog search --processing-base-method ...` through the command/action path.
- There is no test that `--processing-confidence-min` parse errors happen before auth.
- There is no test for the member-gated behavior recommended above.

Why this matters:

This repo treats the CLI as a machine contract. The risk is not just library mapping; it is option discovery, Commander camel-casing, error order, auth requirements, and output behavior at the command boundary.

Recommended correction:

- Add a focused command-level test around `buildCatalogCommand()` or an existing CLI process-boundary harness.
- Mock auth and `searchCatalog` to assert:
  - structured flags are parsed into `processingBaseMethod`, `fermentationType`, `processAdditive`, `processingDisclosureLevel`, and `processingConfidenceMin`.
  - structured flags trigger member auth after argument validation.
  - no structured flags preserve viewer auth.
  - invalid `--processing-confidence-min 1.5` exits as `INVALID_ARGUMENT` before auth.

This is lower priority than the access bug because the existing library mapping is correct, but adding the command/auth test would prevent the exact regression introduced here.

## Intent coverage

### Add structured catalog search options

Satisfied. `src/commands/catalog.ts` defines all five requested options.

### Map to existing catalog query path without breaking legacy `--process`

Mostly satisfied. `src/lib/catalog.ts` maps the new camelCase inputs to the expected catalog columns:

- `processingBaseMethod` to `processing_base_method`
- `fermentationType` to `fermentation_type`
- `processAdditive` to `process_additives` containment
- `processingDisclosureLevel` to `processing_disclosure_level`
- `processingConfidenceMin` to `processing_confidence >= value`

Legacy `--process` still maps to the existing partial `processing` label filter.

The access-control issue above must be patched, but the query mapping itself is correct.

### Preserve process metadata in JSON output

Satisfied for the current direct-Supabase path. `searchCatalog` uses `select('*')`, `CatalogItem` includes the new process metadata fields, and `outputData` serializes raw objects to JSON without dropping fields. This preserves metadata when the database returns it.

Caveat: this does not produce the nested `/v1/catalog` `process` object. Given the stated intent to use the existing catalog query path, I am not treating that as a blocker. The future API-key catalog path should revisit output-shape parity intentionally.

### Update help, manifest, README

Satisfied with one required correction. The surfaces list the new flags and examples, but they need member-gating language after the P1 fix.

### Include focused tests

Partially satisfied. Library-level tests are present and pass. Command/auth boundary coverage is missing.

### Bump minor version

Satisfied. `package.json` changes from `0.15.1` to `0.16.0`. `pnpm-lock.yaml` does not contain a root package version in this lockfile shape, so the lack of a lockfile diff is not a defect.

## Checklist audit

### Core mergeability

- Stated intent is mostly satisfied.
- The PR cannot merge safely as-is because it conflicts with the current process-facet entitlement contract.
- The slice can be made independently mergeable with a same-PR patch. No follow-on PR is required for coherence.
- The implementation changes the correct technical layer for CLI direct-Supabase search, but it misses the newer product layer introduced by ADR-005 and coffee-app PR #302 corrections.

### Scope boundary

The slice boundary is not wrong. Adding structured process filters to the CLI is the intended PR 02. The required fix is local to this PR: auth selection, docs, and tests.

### Evidence discipline

Findings are based on the collected diff, changed source files, product ADRs, and `coffee-app` `origin/main` access-control code.

### Product alignment

Strong alignment with API-first, CLI-first, and process-transparency goals after the entitlement patch. As written, it weakens the access ladder by making member search leverage available to viewer sessions.

## Validation evidence

Validation provided by implementation run:

- `pnpm exec vitest run tests/catalog.test.ts tests/manifest.test.ts`: pass, 72 tests.
- `pnpm check && pnpm lint`: pass.
- `pnpm build`: pass.
- `pnpm exec vitest run tests/dist-contract.test.ts tests/prepublish-parity.test.ts`: pass, 15 tests.
- `pnpm test`: pass, 23 files, 523 tests.
- `git diff --check`: pass.
- GitHub CI run `25184301669`: pass.

Validation rerun during this audit:

- `pnpm exec vitest run tests/catalog.test.ts tests/manifest.test.ts`: pass, 72 tests.

These checks are useful but do not cover the product entitlement defect.

## Required patch summary

1. In `src/commands/catalog.ts`, require member auth when structured process filters are present, preserving viewer auth for ordinary catalog search.
2. Update CLI help, README, and manifest notes to document the member requirement for structured process filters.
3. Add command-level tests for option parsing, dynamic auth selection, and invalid confidence validation before auth.

After those changes and a repeat of the current validation set, PR #103 should be merge-ready.
