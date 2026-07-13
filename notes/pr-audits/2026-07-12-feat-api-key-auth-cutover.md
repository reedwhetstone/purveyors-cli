# Pre-submission audit: API-key auth cutover

**Date:** 2026-07-12
**Branch:** `feat/api-key-auth-cutover`
**Base:** `origin/main`
**Final verdict:** ready
**Scope assessment:** coherent
**Confidence:** high

## Final gate

- P0: 0
- P1: 0
- P2: 0
- P3: 0
- Next action: submit

## Findings resolved before submission

1. Updated the machine-readable manifest to describe stored scoped API-key custody and environment override precedence instead of the removed session runtime. Added regression coverage for the stale claims.
2. Corrected ADR-001 to document create-before-revoke ordering and the actual partial-revocation failure modes.

## Validation

- `pnpm test`: 31 files, 559 tests passed
- `pnpm lint`: passed
- `pnpm check`: passed
- `pnpm verify:prepublish`: passed
- `git diff --check origin/main...HEAD`: passed
- Focused manifest/auth re-review checks: passed
- Coffee-app `origin/main` includes merged PR #462 and accepts owner-bound API-key principals with `roast:read` for `/api/ai/classify-roast`
