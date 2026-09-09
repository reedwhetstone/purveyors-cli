# AGENTS.md

Canonical contributor guide for `@purveyors/cli`.

Use this file as the single maintained guide for humans and agents. `CLAUDE.md` and `GEMINI.md` should point here.

## Project Snapshot

- Package: `@purveyors/cli`
- Binary: `purvey`
- Runtime: Node.js 20+
- Stack: TypeScript, Commander.js, Parchment SDK, Vitest
- Version source of truth: `package.json` and `purvey --version`
- Binary entrypoint: `purvey` via package `bin` field
- Package contract source of truth: `package.json` `exports` plus `src/lib/manifest.ts`
- In-process manifest export: `@purveyors/cli/manifest` via package export `./manifest`
- Live CLI guides: `/docs/cli/*` on `https://purveyors.io`
- Canonical API reference: `https://api.purveyors.io/docs`

## Setup and guidance ownership

Use `pnpm install --frozen-lockfile` for local setup. `AGENTS.md` owns contributor policy; `CLAUDE.md` and `GEMINI.md` are lightweight pointers and need changes only if their target changes.

Discover current commands, flags, roles, and workflow examples from `src/lib/manifest.ts`, the command handlers, and `purvey manifest`; do not duplicate that inventory here.

## Documentation Sources of Truth

When documentation changes, verify against these files first:

- `src/commands/*` for command names, flags, examples, and auth expectations
- `src/program.ts` for global help text and docs links
- `src/lib/manifest.ts` for the machine-readable contract, rendered context text, package export list, ID guidance, and workflow examples
- `package.json` for package metadata, Node engine, scripts, binary entrypoint, and exported subpaths
- `docs/ADR-INDEX.md` for the canonical architecture decision registry
- `README.md` for GitHub and npm landing-page coverage
- `docs/CLI_STRATEGY.md` for historical architecture context that still needs to stay factually correct

Docs links should prefer the current site structure:

- CLI docs: `https://purveyors.io/docs/cli/overview`
- API reference: `https://api.purveyors.io/docs`

Avoid stale references to the old generic `https://purveyors.io/docs` root when a more specific docs target exists.

## Architecture

```text
src/
  index.ts            executable entrypoint
  program.ts          top-level program, global options, command registration
  commands/           Commander command trees and help text
  lib/                Parchment SDK access, output, auth guards, CLI adapters
    cherry.ts         primary Cherry roast-classification helper
    ai.ts             deprecated compatibility re-export of cherry.ts
  types/              shared TypeScript types
tests/                Vitest coverage
```

## Contribution Rules

### Auth and roles

- Use `requireAuth('viewer')` for catalog commands and other viewer-level access, except `catalog search` structured processing filters, which require `member`.
- Use `requireAuth('member')` for personal data, entitled market intelligence, and writes.
- SDK-backed Parchment commands should use `src/lib/parchment.ts`. Explicit environment API keys take precedence over the scoped key created by `purvey auth login`; the canonical API enforces owner-bound scopes and entitlements.
- `auth`, `config`, `context`, and `manifest` do not require pre-existing credentials.
- `catalog`, `inventory`, `roast`, `sales`, and `tasting` require authentication.
- Keep docs aligned with actual handler behavior. If auth requirements change, update README, help text, and context in the same PR.
- Preserve both supported login paths: browser approval with automatic polling, and `auth login --headless` for agents, CI, SSH sessions, and remote hosts. Neither path uses a localhost callback or pasted URL.
- Device authorization secrets are memory-only. Never persist the signed request token or PKCE verifier.
- Exit code `3` is returned on any auth failure (not logged in, revoked or invalid stored key, or insufficient role).

### Machine contract and exports

- Treat the CLI binary, exported subpaths, manifest payload, context text, stdout/stderr behavior, and exit codes as one product contract.
- `@purveyors/cli` consumes `@purveyors/sdk`; the SDK never consumes CLI functions.
- `coffee-app` consumes `@purveyors/sdk` directly and does not depend on this package. Shared cross-surface data behavior belongs in Parchment and its OpenAPI contract.
- Agent runtimes may import exported CLI functions when they intentionally need CLI semantics. Prefer narrow imports such as `@purveyors/cli/catalog` instead of the package root.
- Use `@purveyors/cli/cherry` for roast classification. `@purveyors/cli/ai` remains a deprecated compatibility alias so existing integrations do not break.
- When package exports change, keep `package.json`, the manifest, affected consumer docs, and packaged-artifact coverage aligned. Update contributor policy or architecture history only when their claims change.
- `purvey manifest` is the primary shell-level machine contract. `@purveyors/cli/manifest` is the primary in-process machine contract.

### Output contract

- Keep user-facing data on stdout.
- Keep status and spinner messaging on stderr.
- Fatal errors stay on stderr, but the format depends on mode:
  - interactive TTY with no explicit output flag: human-readable text
  - `--json`, `--pretty`, or `--csv`: JSON error envelope on stderr
  - non-interactive with no explicit flag: compact JSON error envelope on stderr
- Default success output is compact JSON.
- Treat `--json` as an explicit alias for the default compact JSON mode.
- Use `--pretty` for formatted JSON and `--csv` where CSV output is supported.
- Prefer `outputData()` and `formatStructuredOutput()` so success/error JSON formatting shares one source of truth.
- Avoid command-specific human-readable defaults for data commands unless there is a strong reason and the divergence is documented.
- `auth status` is the intentional auth exception: in machine mode it can emit structured auth-state JSON on stdout even when unauthenticated.
- `auth status --csv` is supported, but JSON remains the preferred integration format.
- `config list/get/set/reset` are the intentional local-command exception: interactive TTYs stay human-readable, but `--json` / `--pretty` and non-interactive use emit structured JSON on stdout. `--csv` is not supported.

### Help text

- Every command should have real examples.
- Keep examples copy-pasteable.
- Do not document flags that are not wired in code.
- Do not leave stale release numbers or command names in help text.

### Documentation and validation

Inspect affected consumers when commands, auth, exports, scripts, or output behavior change: README, command help, manifest/context rendering, package metadata, and relevant architecture or downstream docs. Update surfaces whose claims or behavior change; do not mechanically edit every file or regenerate pointer files. Keep `purvey manifest` primary and `purvey context --json` in exact compatibility parity.

Choose one validation path for the change, based on the current `package.json` script graph:

- **Instruction/docs-only, with no published contract claim changed:** inspect links and factual claims against their owners; run `pnpm exec prettier --check <changed Markdown files>` and `git diff --check`. No build or application test suite is required just for a PR description or contributor-policy edit.
- **Code changes outside package/command/help/manifest/output contracts:** run `pnpm lint`, `pnpm build`, and `pnpm test`. Build includes TypeScript checking; the full test suite includes contract and dist tests. Add targeted regression evidence when needed, without rerunning those same tests separately.
- **Package, release, command/help/manifest/output contract changes, including README release-contract claims:** run `pnpm lint`, `pnpm verify:prepublish`, then `pnpm exec vitest run --exclude tests/manifest.test.ts --exclude tests/cli-output-modes.test.ts --exclude tests/dist-contract.test.ts`. The prepublish umbrella cleans and builds dist, runs contract and dist tests, then checks actual packed-artifact parity. The remaining suite covers other behavior without repeating those test files. A standalone `pnpm check`, build, or verification subcommand adds no coverage to this path.

The package runs from `dist/`, not `src/`; source tests alone do not prove packaged exports or binary parity. Keep the script graph and these paths aligned if scripts change. Record commands and results for the validated revision. Reuse successful evidence for an unchanged head and environment; PR-body-only updates do not trigger reruns. Revalidate affected checks after new changes, failures, or a material environment change. Report actual blockers rather than claiming unrun checks passed.

## Common Gotchas

- `catalog_id` is not the same as inventory `id`. Never mix them.
- `tasting get <bean-id>` uses a `catalog_id` (coffee_catalog row). It is NOT an inventory ID.
- `tasting rate [bean-id]` uses an `inventory id` (green_coffee_inv.id). It is NOT a catalog ID.
- `roast --coffee-id` expects an inventory ID, not a catalog ID.
- `sales list --coffee-id` expects an inventory ID; `sales record --roast-id` expects a roast ID.
- `context.ts` and `manifest.ts` are easy to forget when command flags or output behavior change.
- `inventory list`, `roast list`, and `sales list` all support `--offset` for pagination. Keep docs in sync when adding new list flags.
- `roast import` and `roast watch` normalize file and directory path input by trimming whitespace, removing one layer of matching quotes, and unescaping common shell-escaped characters. Preserve this when changing Artisan workflows.
- `roast watch` must remain graceful on shutdown: Ctrl+C, raw Ctrl+C key input, or SIGTERM should wait for active imports, commit queued batch-mode roasts, print the verification summary, and keep `--resume` state coherent.
- Catalog commands require viewer auth, except `catalog search` structured processing filters, which require member auth. Downstream docs (coffee-app site, etc.) that claim catalog access is unauthenticated are wrong and should align with this repo.

## Release Notes

- Keep the version in `package.json` authoritative.
- After merge, tag `vX.Y.Z` to publish to npm through GitHub Actions.
- Do not rely on hardcoded version strings in docs when they can drift.
- `prepack` runs `npm run verify:prepublish`, which rebuilds first, so release artifacts fail fast if command contracts, dist parity, docs, or package exports drift.
