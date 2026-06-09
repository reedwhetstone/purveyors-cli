# Catalog Agent Intelligence Program

**Date:** 2026-06-09
**Repo:** `purveyors-cli`
**Strategy context:** The CLI is a core agent-first product surface. This program turns catalog rows into market-understanding primitives that agents can import directly and humans can call from the terminal.

## Problem

`purvey catalog search` can retrieve rows, but agents still need to hand-roll market interpretation: which coffees are high-scoring, which suppliers have strong active coverage, which suppliers specialize by origin/process, and where pricing sits. That makes agent behavior inconsistent across CLI, web, API, and internal automation.

## Program principles

- Keep reusable source of truth in `src/lib/catalog.ts`; CLI wrappers only parse flags and output function results.
- Build from available catalog fields. Do not invent backend endpoints or opaque scores.
- Preserve transparent score provenance: expose `score_value` as `purveyor_score.value` and state when scores are unavailable.
- Make every PR independently useful if later slices never ship.

## PR sequence

### PR 1: Catalog premium ranking and supplier aggregates

**Scope**

- Add reusable exported catalog intelligence functions:
  - `catalogRankPremium`
  - `supplierList`
  - `supplierDetail`
  - `supplierRank`
- Add pure compute helpers for ranking and supplier summaries so coffee-app can import the same logic later.
- Add CLI commands under `purvey catalog` that call those library functions:
  - `rank-premium`
  - `supplier-list`
  - `supplier-detail <supplier>`
  - `supplier-rank`
- Include Purveyor Score fields in the ranked output as a structured `purveyor_score` object derived from existing `score_value`.

**Acceptance criteria**

- [ ] Agents can import the functions from `@purveyors/cli/catalog` and `@purveyors/cli/lib`.
- [ ] `catalogRankPremium` returns a ranked list with `rank`, key catalog context, `purveyor_score`, pricing, stocked status, and transparent ranking signals.
- [ ] Supplier aggregate functions return supplier-level counts, stocked counts, score coverage, average Purveyor Score, average price, origin/process coverage, and representative top coffees.
- [ ] CLI commands use library functions rather than duplicating aggregation logic.
- [ ] Local validation passes: `pnpm check`, `pnpm test`, `pnpm build`.

### PR 2: Agent manifest and documentation polish for catalog intelligence

**Scope**

- Update manifest/tool metadata so agents discover the new intelligence commands/functions with examples.
- Expand README examples for market-understanding workflows.
- Add command-output contract examples for the new JSON shapes.

**Acceptance criteria**

- [ ] Manifest lists the new commands with arguments, access requirements, and machine-usage examples.
- [ ] README has concise examples for premium ranking and supplier comparison.
- [ ] Existing manifest and dist parity tests remain green.

### PR 3: Movement and procurement brief planning surface

**Scope**

- Add an implementation plan for inventory-aware catalog movement and procurement brief functions after the ranking primitives have settled.
- Define API/backend field gaps, if any, before implementation.

**Acceptance criteria**

- [ ] Plan distinguishes catalog-only intelligence from owned-inventory intelligence.
- [ ] Each future slice is independently mergeable.
- [ ] No backend endpoint is invented without evidence of available fields or a follow-up backend PR.
