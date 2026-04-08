# 2026-04-08 Implementation Plan — Machine-Readable CLI Contract

## Selected Improvement

Add a machine-readable CLI contract for `@purveyors/cli` so coffee-app, external agents, docs, and future codegen can consume the same authoritative command metadata instead of inferring capabilities from hand-written help text.

## Problem Description With Evidence

The CLI already drives multiple surfaces, but its contract is still mostly human-only. That creates drift.

### Evidence

1. **Installed CLI help can lag the repo and mislead agents.**
   - Global `purvey --version` returns `0.9.3`.
   - Repo `package.json` version is `0.10.0`.
   - Running the global `purvey inventory list --help` did not show `--offset`, even though current repo source and `dist/commands/inventory.js` include it.

2. **coffee-app has stale assumptions about current CLI capabilities.**
   - `repos/coffee-app/src/lib/services/tools.ts` still says catalog `variety`, `stocked_days`, and `drying_method` are client-side-only filters.
   - Current CLI source in `repos/purveyors-cli/src/lib/catalog.ts` already supports those filters in `searchCatalogSchema`.
   - `tools.ts` also still treats roast date filtering as client-side post-filtering, while current CLI `listRoastsSchema` supports `date_start`, `date_end`, and `coffee_name`.

3. **The product and ADR strategy explicitly want CLI-as-source-of-truth, but the contract is not yet consumable as data.**
   - `notes/decisions/001-cli-subpath-exports-for-chat-agent.md` says the CLI should be the single source of truth for shared operations.
   - `docs/CLI_STRATEGY.md` explicitly points toward auto-generated tool definitions from CLI metadata/help.
   - Current `src/commands/context.ts` is a dense hand-written text block, useful for humans but not a stable machine contract.

### Why This Matters

When downstream consumers cannot reliably read the CLI contract as structured data, they reimplement filters, keep stale comments, and miss new capabilities. That weakens the flywheel where CLI improvements should automatically improve coffee-app and agent behavior.

## Root Cause Analysis

The CLI contract currently lives in several separate layers:

- Commander option definitions
- Zod schemas in `src/lib/*`
- hand-written onboarding text in `src/commands/context.ts`
- root help text in `src/index.ts`
- downstream wrapper assumptions in coffee-app

None of these layers is exposed as a canonical machine-readable contract. As a result:

- downstreams infer capabilities manually
- newly added flags or filters do not propagate automatically
- help/docs drift from actual behavior
- agent integrations cannot safely introspect supported commands, output modes, auth requirements, or exit-code behavior

## Proposed Fix

Add a new machine-readable manifest surface, backed by a shared metadata source, and use it to tighten parity between CLI behavior and downstream consumers.

### Scope

Implement a **v1 contract manifest** that covers:

- global output modes (`--json`, `--pretty`, `--csv`)
- auth requirements by command
- command/subcommand names
- supported flags/options
- key input/output notes
- ID-type guidance
- structured error / exit-code reference

### Specific Files To Change

1. **New:** `src/lib/manifest.ts`
   - Define typed manifest structures for commands, options, auth requirements, output modes, and exit codes.
   - Export `getCliManifest()` or equivalent.

2. **Update:** `src/commands/context.ts`
   - Replace the giant hand-maintained text block with rendering from the shared manifest source where practical.
   - Keep human-readable `purvey context`, but derive it from the same metadata.

3. **Update:** `src/index.ts`
   - Add a new `manifest` command, or extend `context` with `--json`.
   - Ensure one stable machine-readable entry point exists.

4. **Update:** `src/lib/index.ts`
   - Export the manifest helper for library consumers.

5. **Optional export:** `package.json`
   - Add a subpath export like `./manifest` if needed for downstream imports.

6. **New tests:** `tests/manifest.test.ts`
   - Validate manifest shape and critical command coverage.

7. **Update tests if needed:** `tests/cli-output-modes.test.ts`, `tests/exit-codes.test.ts`
   - Add smoke coverage that the machine-readable contract reflects real output-mode and exit-code behavior.

## Pattern Scope

This applies to the full shared-contract pattern across these command groups:

- `auth`
- `catalog`
- `inventory`
- `roast`
- `sales`
- `tasting`
- `config`
- `context` / root help

It also affects downstream consumers that depend on CLI metadata indirectly:

- coffee-app `src/lib/services/tools.ts`
- coffee-app CLI docs surfaces
- future agent/codegen flows

## Acceptance Criteria

1. The CLI exposes one stable machine-readable contract surface, either:
   - `purvey manifest --json`, or
   - `purvey context --json`.

2. The contract includes, at minimum:
   - command tree
   - option names and argument shapes
   - auth requirement per command group
   - output mode support
   - exit-code/error reference

3. The contract explicitly covers capabilities that recently drifted downstream, including:
   - `catalog search --variety`
   - `catalog search --drying-method`
   - `catalog search --stocked-days`
   - `inventory list --offset`
   - `roast list --date-start`
   - `roast list --date-end`
   - `sales list --offset`

4. Human-readable `purvey context` remains available and is either generated from, or parity-tested against, the same source of truth.

5. Library consumers can import the manifest without shelling out to parse help text.

6. Tests fail if a covered command loses metadata parity with the manifest.

## Test Plan

1. **Manifest unit tests**
   - assert the manifest is valid JSON-serializable data
   - assert all top-level command groups are present
   - assert critical options above are present

2. **CLI smoke tests**
   - run the machine-readable contract command and verify valid JSON output
   - verify `purvey context` still prints readable text

3. **Parity tests**
   - verify manifest entries match the current command implementation for a representative set of flags
   - verify exit-code metadata includes the structured error cases already documented in `context.ts`

4. **Regression-focused checks**
   - add at least one test proving pagination metadata exists for `inventory list`, `roast list`, and `sales list`
   - add at least one test proving catalog filter metadata includes `variety`, `drying_method`, and `stocked_days`

## Risk Assessment

**Risk: Low-Medium**

### Main risks

- Creating yet another metadata layer would worsen duplication if it is not actually treated as the source of truth.
- Over-scoping into full tool/code generation would turn a good small contract pass into a bigger platform project.
- Commander help text and manifest structure could drift if parity is only manual.

### Mitigations

- Keep scope to a v1 manifest only.
- Reuse the manifest to render `context` where practical.
- Add parity tests around the exact capability areas that already drifted.
- Do not bundle downstream coffee-app migration into this PR.

## Strategy Alignment Audit

- **Canonical direction:** This directly supports `repos/coffee-app/notes/PRODUCT_VISION.md` Principle 3, “API-first is product strategy, not implementation detail,” by making CLI capabilities legible and shareable across web, CLI, and agent surfaces.
- **Strategic value:** Highest value is cross-surface consistency. Secondarily, it strengthens decision quality for agents by reducing stale assumptions and makes the CLI more usable as a platform surface.
- **Why now:** The repo just added more CLI capability, but downstream consumers are already lagging behind. A structured contract prevents repeated drift and multiplies the value of recent command/filter work.
- **Scope discipline:** This plan intentionally excludes coffee-app migration, docs-site regeneration, and broad codegen. It only establishes the contract surface those follow-ups need.
- **Tension / risk:** There is a tradeoff between speed and true single-source-of-truth design. If the manifest is hand-maintained beside Commander/Zod definitions, it becomes new debt. The implementation should bias toward shared metadata or parity enforcement, not parallel manual docs.

## Alternatives Considered

1. **Add offset integration tests for inventory and sales only**
   - Very small and low risk.
   - Rejected because impact is too narrow relative to the broader cross-surface drift now visible.

2. **Add stale-install/update warnings because global `purvey` is behind repo main**
   - Useful onboarding polish.
   - Rejected because it treats the symptom, not the contract-drift cause.

3. **Add coffee-app-specific write adapters in the CLI immediately**
   - Potentially high flywheel.
   - Rejected for this pass because the most structural missing piece is still the machine-readable contract that tells downstreams what the CLI already supports.

## Open Questions

1. Should the machine-readable surface be a new `manifest` command or `context --json`?
2. Should manifest metadata live in one central object, or be composed from per-command definitions?
3. Is `package.json` subpath export `./manifest` worth adding in v1, or is runtime CLI JSON output enough for the first pass?
4. How much of `context.ts` should be generated versus preserved as curated explanatory prose?
