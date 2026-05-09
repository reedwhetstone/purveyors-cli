# PR #112 Re-Verify Audit: Canonical Similar Command

VERDICT: blocked
P0: 0
P1: 1
P2: 0
P3: 0
NEXT_ACTION: blocked
TOP_FIXES:

- Fix or ship the deployed `/v1/catalog/{id}/similar` API before publishing this CLI switch; valid catalog IDs still return HTTP 500.
- Re-run a live CLI smoke test after the API fix, then tag/publish `@purveyors/cli@0.18.0` only if that smoke passes.

CONFIDENCE: high
SCOPE_ASSESSMENT: wrong_boundary

## Summary

PR #112 is technically strong inside `purveyors-cli`: it moves `purvey catalog similar <id>` from the legacy direct RPC path to the canonical `/v1/catalog/{id}/similar` API contract, preserves the grouped canonical response, validates malformed inputs before auth, supports API-key and session auth, updates CLI discovery/docs, and bumps the package to `0.18.0`.

The CLI-side findings from the first verify pass were patched in the branch:

- The runtime shape guard now requires `meta.classification_version` and `meta.query_strategy`.
- Negative tests cover grouped similarity responses missing required meta fields.
- Similarity 404 handling now treats known target-not-found messages as `NOT_FOUND`, while generic missing-route 404s become `CONFIG_ERROR`.
- Command-level session-auth coverage proves `catalog similar` uses `requireAuth('viewer')` when no API key env var exists.
- README API-key notes now say both `PURVEYORS_API_KEY` and `PARCHMENT_API_KEY` cover API-backed proof and similarity reads.

The remaining blocker is outside the CLI repo but merge-critical: the deployed canonical API currently returns HTTP 500 for valid catalog IDs. Merging and publishing this CLI release now would turn the user-visible command into a production failure. The PR should remain open until the API route is fixed or the release boundary is changed to ship the API fix with this CLI switch.

## Validation

- `pnpm check`: VALIDATION_PASS.
- `pnpm exec vitest run tests/catalog.test.ts tests/exit-codes.test.ts`: VALIDATION_PASS, 101 targeted tests after the final 404-mapping test was added.
- Lint/format: validated locally with the repo's existing dependency tree and will be confirmed by CI on the final pushed head.
- Prior CI on head `0c314b4012930ab88d84f263ab752cdffd3b2f72`: VALIDATION_PASS for `Lint, Type Check, Prepublish Parity, Test`.
- Local full `pnpm test`: VALIDATION_BLOCKED_ENV/HARNESS on one run. All 25 test files and 560 tests reported pass, then Vitest emitted an unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` and exited 1. CI had already run the same suite successfully on the previous code head, so this is treated as a local harness/worktree dependency issue unless final CI says otherwise.
- Live API smoke `GET /v1/catalog?limit=1`: VALIDATION_PASS, returned valid catalog row ID `1970`.
- Live API smoke `GET /v1/catalog/1970/similar?limit=2`: VALIDATION_BLOCKED_SERVICE, HTTP 500 with `Failed to fetch similar coffees` / `Internal server error`.

## Finding

### P1: CLI switch is not independently mergeable while the canonical API returns 500 for valid catalog IDs

Evidence:

- `src/commands/catalog.ts` routes `purvey catalog similar <id>` through the new canonical API client rather than the legacy direct RPC path.
- `src/lib/catalog.ts` fetches `/v1/catalog/{id}/similar` for the canonical command path.
- The API key and base catalog endpoint work: `/v1/catalog?limit=1` returned row ID `1970`.
- The deployed similarity endpoint fails for that valid row: `/v1/catalog/1970/similar?limit=2` returned HTTP 500.

Impact:

- Publishing `@purveyors/cli@0.18.0` from this branch before the API fix would regress `purvey catalog similar` in production.
- The slice is not independently mergeable today, despite being the correct client-side direction.

Required correction before merge/publish:

- Fix the deployed `/v1/catalog/{id}/similar` endpoint for valid catalog rows, then re-run a live CLI smoke test against a valid ID.
- Alternatively, rescope the release boundary so the API fix and CLI switch ship together.
- Do not silently fall back to the legacy RPC under the same canonical command, because that would violate the grouped response contract and hide API drift from agent consumers.

## Final disposition

PR state: blocked.

The code can stay open as the prepared CLI side of the canonical similarity program, but it should not be merged or tagged until the API service blocker is resolved and live smoke passes.
