# 2026-04-09 Implementation Plan — `purvey manifest` command

## Selected Improvement

Add a dedicated `purvey manifest` root command that emits the machine-readable CLI contract directly, while keeping `purvey context` as the human-first reference.

## Why this is the right fallback slice

The 2026-04-08 machine-readable contract plan already shipped as `purvey context --json`, but the newest plan left one open product question unresolved: should the contract also have a dedicated `manifest` entry point?

Today there is still a discoverability gap:

- agents and scripts must know the special `context --json` flag combination
- root `purvey --help` does not expose a plainly named machine-readable command
- the product strategy wants API-first, cross-surface contracts that are obvious and stable for downstream consumers

This is a small, independently shippable slice. It reuses the existing manifest source of truth instead of reopening the broader contract work.

## Strategy alignment

- **Product vision:** strengthens API-first, cross-surface consistency by making the CLI contract more legible to agents and scripts.
- **ADR-001:** reinforces the CLI as the source of truth for downstream consumers.
- **Scope discipline:** no redesign, no new metadata system, no coffee-app migration. Just a dedicated surface over the existing manifest.

## Proposed change

1. Add a new root command: `purvey manifest`
   - default output: compact JSON
   - `--pretty` for indented JSON
   - `--json` accepted for symmetry
   - reject `--csv`
2. Keep `purvey context` human-readable by default
3. Update root help, manifest metadata, and README so the new command is discoverable
4. Add parity and smoke tests proving `purvey manifest` matches `purvey context --json`

## Acceptance criteria

- `purvey manifest` exists as a root command
- `purvey manifest` emits valid JSON by default
- `purvey manifest --pretty` emits indented JSON
- `purvey context` remains human-readable by default
- manifest metadata and `purvey --help` document the new command
- tests verify output parity between `purvey manifest` and `purvey context --json`

## Test plan

- `pnpm check`
- `pnpm lint`
- `pnpm test`
- smoke test `purvey manifest`
- smoke test `purvey context`
