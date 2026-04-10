# 2026-04-10 Implementation Plan — Compiled CLI Artifact Parity Guardrails

## Selected Improvement

Add build and test guardrails that keep the compiled CLI artifact (`dist/`) in parity with the source-of-truth command surface.

## Problem Description with Evidence

The CLI now treats machine-readable onboarding as a first-class product surface, but the compiled artifact currently drifts from source:

- `package.json` points both the binary and public package entrypoint at `dist/index.js`.
- `src/program.ts` registers `buildManifestCommand()` and documents `purvey manifest` as the primary machine-readable CLI surface.
- `node dist/index.js manifest` currently fails with `unknown command 'manifest'`.
- `node dist/index.js --help` omits the `manifest` root command and still points agents to `purvey context --json`.
- `node dist/index.js context --json` emits the older manifest shape, with no root `manifest` command group and the older nested `context` contract.
- Current automated coverage protects source only:
  - `tests/manifest.test.ts` shells through `pnpm exec tsx src/index.ts ...`
  - `.github/workflows/ci.yml` runs lint, typecheck, and tests, but never runs `pnpm build`
- Contributor docs are also missing part of the drift surface. `AGENTS.md` still says to update README, AGENTS, CLAUDE, `src/commands/context.ts`, and command help text, but it does not mention `src/commands/manifest.ts`, `src/lib/manifest.ts`, manifest tests, or compiled artifact smoke checks.

This creates a real user-facing contract problem for both humans and agents: the repo source, docs, and tests say one thing, while the shipped executable artifact says another.

## Root Cause Analysis

The repo has strong source-level contract coverage, but no distribution-level parity coverage.

1. Command-surface work landed in source (`src/program.ts`, `src/commands/manifest.ts`, `src/lib/manifest.ts`, README, tests).
2. The compiled artifact in `dist/` was not rebuilt and re-verified as part of normal CI.
3. Existing tests exercise TypeScript entrypoints through `tsx`, so they cannot catch stale compiled output.
4. The contributor checklist documents truth-surface updates, but not the built artifact that end users actually execute.

The structural issue is not the manifest feature itself. The issue is that the repo lacks a guardrail for the runtime artifact that the package exports.

## Proposed Fix

Add a narrow artifact-parity slice, not a broader command redesign.

### 1. Add distribution verification scripts

Update `package.json` with an explicit dist-validation path, for example:

- `build` remains `tsc`
- add `verify:dist` or equivalent script for compiled-artifact smoke tests
- optionally add a release-safe hook such as `prepack` or `prepublishOnly` if that fits the existing publish flow

Goal: make built-artifact verification a named, repeatable workflow rather than tribal knowledge.

### 2. Add compiled-artifact contract tests

Add a targeted test file, likely `tests/dist-contract.test.ts`, that verifies the built CLI surface after `pnpm build`:

- `node dist/index.js --help` includes `manifest`
- `node dist/index.js manifest` exits `0` and emits valid JSON
- `node dist/index.js context --json` exits `0` and matches the source manifest shape
- `node dist/index.js manifest` stays in parity with `pnpm exec tsx src/index.ts manifest`

Keep the assertions focused on contract-critical behavior, not brittle full-output snapshots.

### 3. Run build + dist verification in CI

Update `.github/workflows/ci.yml` so command-surface drift cannot merge silently:

- run `pnpm build`
- run the new dist verification step after build

This closes the current gap where CI can pass while `dist/` is stale.

### 4. Tighten contributor docs and checklist

Update `AGENTS.md` and the `CLAUDE.md` pointer/checklist so command-surface changes explicitly require auditing:

- `src/commands/context.ts`
- `src/commands/manifest.ts`
- `src/lib/manifest.ts`
- `src/program.ts` root help text
- `README.md`
- relevant tests
- compiled artifact smoke checks after build

This keeps the repo’s “never repeat truth” discipline honest across the full operator surface.

## Files to Change

Primary files:

- `package.json`
- `.github/workflows/ci.yml`
- `tests/manifest.test.ts` or new `tests/dist-contract.test.ts`
- `AGENTS.md`
- `CLAUDE.md`

Potentially touched for small alignment updates:

- `README.md`
- `src/program.ts` only if a test exposes another help-text mismatch

## Acceptance Criteria

- A fresh build produces a compiled CLI that exposes `purvey manifest`.
- `node dist/index.js manifest` exits `0` and returns valid JSON.
- `node dist/index.js context --json` matches the current manifest contract shape.
- `node dist/index.js --help` documents the same machine-readable entrypoint as source and README.
- CI fails if source and compiled artifact drift.
- Contributor docs explicitly include the manifest command and built-artifact verification in the command-surface checklist.

## Test Plan

- `pnpm build`
- `pnpm test -- tests/manifest.test.ts tests/dist-contract.test.ts` (or equivalent targeted suite)
- `node dist/index.js --help`
- `node dist/index.js manifest`
- `node dist/index.js context --json`
- parity check between built artifact output and source entrypoint output for manifest/context contract surfaces

## Risk Assessment

**Low to moderate.**

This is a guardrail change, not a behavior redesign. The main risks are:

- overly brittle tests if they snapshot too much help text
- slightly longer CI time from adding a build step
- confusion if release hooks are made too aggressive for local development

These risks are manageable if the tests assert contract-critical substrings and structural JSON parity rather than full exact output.

## Strategy Alignment Audit

- **Canonical direction:** This aligns directly with `repos/coffee-app/notes/PRODUCT_VISION.md` and ADR-001. Purveyors is explicitly API-first across web, CLI, and agent surfaces. A stale compiled CLI breaks that cross-surface promise.
- **Strategic value:** This improves cross-surface consistency and decision quality for agentic consumers. If the CLI contract drifts between source and executable artifact, the chat agent and external scripts cannot reliably treat the CLI as a source of truth.
- **Why now:** The manifest/context work just raised the CLI contract to a first-class product surface. Guarding the shipped artifact now is strategically stronger than adding another feature on top of an unprotected runtime boundary.
- **Scope discipline:** This intentionally excludes new coffee features, auth changes, manifest redesign, removal of committed `dist/`, and coffee-app integration work. The slice is only: keep the executable artifact truthful.
- **Tension / risk:** There is a broader architectural question about whether committed `dist/` should remain part of the repo workflow at all. That is a separate decision. This plan assumes the current model remains and adds guardrails around it.

## Pattern / Shared Surface Audit

If this fix lands, audit every surface that shares the machine-readable onboarding story:

- `package.json` bin/exports
- `src/program.ts`
- `src/commands/context.ts`
- `src/commands/manifest.ts`
- `src/lib/manifest.ts`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `tests/manifest.test.ts`
- new dist smoke tests
- `.github/workflows/ci.yml`
- compiled `dist/` output itself

## Alternatives Considered

1. **Add another CLI feature instead**
   - Rejected for today. The highest-impact issue is that the existing contract surface is not reliably what users execute.

2. **Fix coffee-app tool parity first**
   - Rejected as the primary slice. Some chat-tool gaps are actually coffee-app integration debt, not missing CLI capability.

3. **Do docs-only cleanup**
   - Rejected as insufficient. The failure mode is runtime artifact drift, so docs alone would not prevent recurrence.

## Open Questions

1. Should dist parity live in a dedicated `tests/dist-contract.test.ts`, or should `tests/manifest.test.ts` own both source and compiled-artifact coverage?
2. Should release safety use CI-only verification, or also a local hook like `prepack`/`prepublishOnly`?
3. Is the team intentionally committing `dist/`, or should a later ADR revisit a source-only repo plus publish-time build model?
