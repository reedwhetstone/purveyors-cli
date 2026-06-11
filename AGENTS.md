# AGENTS.md

Canonical contributor guide for `@purveyors/cli`.

Use this file as the single maintained guide for humans and agents. `CLAUDE.md` and `GEMINI.md` should point here.

## Project Snapshot

- Package: `@purveyors/cli`
- Binary: `purvey`
- Runtime: Node.js 20+
- Stack: TypeScript, Commander.js, Supabase JS, Vitest
- Version source of truth: `package.json` and `purvey --version`
- Binary entrypoint: `purvey` via package `bin` field
- Package contract source of truth: `package.json` `exports` plus `src/lib/manifest.ts`
- In-process product exports: `@purveyors/cli/catalog`, `/inventory`, `/roast`, `/sales`, `/tasting`, `/lib`, `/manifest`, `/artisan`, and `/ai`
- In-process manifest export: `@purveyors/cli/manifest` via package export `./manifest`
- Live docs: `/docs/cli/*` and `/docs/api/*` on `https://purveyors.io`

## Canonical Agent Docs Policy

- `AGENTS.md` is the canonical maintained guide.
- `CLAUDE.md` and `GEMINI.md` must stay lightweight pointers to this file.
- If agent guidance changes, update `AGENTS.md` first and keep pointer files minimal.
- Do not let agent-specific copies drift into separate maintained documentation.

## What the CLI Covers

Current command groups:

- `auth`: `login`, `status`, `logout`
- `catalog`: `search` (filters: origin, process, price-min/max, flavor, name, supplier, ids, stocked, variety, drying-method, stocked-days, processing-base-method, fermentation-type, process-additive, processing-disclosure-level, processing-confidence-min, sort, offset, limit; proof output via `--include-proof`), `get <id>`, `stats`, `facets <field>`, `rank`, `rank-premium`, `supplier-list`, `supplier-detail <supplier>`, `supplier-rank`, `similar <id>`. Structured processing filters require the `member` role under the current session-authenticated CLI path.
- `inventory`: `list` (filters: stocked, catalog-id, purchase-date-start, purchase-date-end, origin, limit, offset), `get <id>`, `add`, `update <id>`, `delete <id>` (`--force` for cascade delete)
- `roast`: `list` (filters: coffee-id, roast-id, batch-name, coffee-name, date-start, date-end, stocked, catalog-id, limit, offset), `get <id>`, `create`, `update <id>`, `delete <id>`, `import [file]`, `watch [directory]`
- `sales`: `list` (filters: roast-id, date-start, date-end, buyer, limit, offset), `record`, `update <id>`, `delete <id>`
- `tasting`: `get <bean-id>`, `rate [bean-id]`
- `config`: `list`, `get <key>`, `set <key> <value>`, `reset`
- `context`: dense human-readable agent reference for the CLI, or manifest-compat JSON with `--json`/`--pretty`
- `manifest`: preferred machine-readable CLI manifest contract for agents and scripts

If you change this surface, update all of these in the same PR:

1. `README.md`
2. `AGENTS.md`
3. `CLAUDE.md` and `GEMINI.md` pointers
4. `docs/CLI_STRATEGY.md` when historical or architecture claims change
5. `src/commands/context.ts`
6. `src/commands/manifest.ts`
7. `src/lib/manifest.ts`
8. command help text in `src/commands/*` and `src/program.ts` when affected
9. compiled artifact checks after `npm run build` (`node dist/index.js --help`, `node dist/index.js manifest`, `node dist/index.js context --json`)
10. relevant tests, including dist parity coverage

## Local Setup

```bash
pnpm install
npm run build
npm run verify:contract
npm run verify:dist
npm run verify:prepublish
npm run check
npm run lint
npm test
```

Use `pnpm install` for local setup. Use the package scripts for validation.

## Documentation Sources of Truth

When documentation changes, verify against these files first:

- `src/commands/*` for command names, flags, examples, and auth expectations
- `src/program.ts` for global help text and docs links
- `src/lib/manifest.ts` for the machine-readable contract, rendered context text, package export list, ID guidance, and workflow examples
- `package.json` for package metadata, Node engine, scripts, binary entrypoint, and exported subpaths
- `README.md` for GitHub and npm landing-page coverage
- `docs/CLI_STRATEGY.md` for historical architecture context that still needs to stay factually correct

Docs links should prefer the current site structure:

- CLI docs: `https://purveyors.io/docs/cli/overview`
- API docs: `https://purveyors.io/docs/api/overview`

Avoid stale references to the old generic `https://purveyors.io/docs` root when a more specific docs target exists.

## Architecture

```text
src/
  index.ts            executable entrypoint
  program.ts          top-level program, global options, command registration
  commands/           Commander command trees and help text
  lib/                Supabase access, output, auth guards, business logic
  types/              shared TypeScript types
tests/                Vitest coverage
```

Command files:

- `auth.ts`: browser OAuth with pasted-callback fallback, headless OAuth, status, logout
- `catalog.ts`: catalog search, fetch, stats, premium ranking, supplier aggregates, similar-bean lookup
- `inventory.ts`: personal green coffee inventory CRUD
- `roast.ts`: roast CRUD, Artisan import, watch mode
- `sales.ts`: sales CRUD
- `tasting.ts`: tasting lookup and cupping scores
- `config.ts`: local CLI config
- `context.ts`: dense agent-oriented reference output, with optional JSON manifest mode
- `manifest.ts`: machine-readable CLI manifest command and contract output

## Contribution Rules

### Auth and roles

- Use `requireAuth('viewer')` for catalog commands and other viewer-level access, except `catalog search` structured processing filters, which require `member`.
- Use `requireAuth('member')` for personal data and writes.
- `auth`, `config`, `context`, and `manifest` do not require a pre-existing authenticated session.
- `catalog`, `inventory`, `roast`, `sales`, and `tasting` require authentication.
- Keep docs aligned with actual handler behavior. If auth requirements change, update README, help text, and context in the same PR.
- Preserve both supported login paths: browser OAuth with localhost callback capture plus pasted-callback fallback, and `auth login --headless` for agents, CI, SSH sessions, and remote hosts.
- The browser-login pasted-callback fallback must ignore invalid callback URLs and keep waiting so users can retry while the localhost callback listener remains active.
- Exit code `3` is returned on any auth failure (not logged in, expired session, or insufficient role).

### Machine contract and exports

- Treat the CLI binary, exported subpaths, manifest payload, context text, stdout/stderr behavior, and exit codes as one product contract.
- `coffee-app` and agent runtimes import exported functions directly; do not treat package exports as internal implementation details.
- Prefer narrow subpath imports in app and agent code, for example `@purveyors/cli/catalog` instead of the package root for catalog workflows.
- When package exports change, update `package.json`, `README.md`, `AGENTS.md`, `docs/CLI_STRATEGY.md`, `src/lib/manifest.ts`, and dist parity validation in the same PR.
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

### Docs discipline

This repo has several documentation surfaces that drift easily. When changing commands, options, auth behavior, package exports, scripts, or output behavior, audit the full set rather than patching one file.

- Treat the CLI as a core agent-first product surface, not a sidecar utility. The binary, exported functions, manifest, context output, and headless auth flow are all part of the product contract.
- Prefer `purvey manifest` as the primary machine-readable contract in docs and examples.
- Keep `purvey context --json` in exact parity, but document it as a compatibility surface rather than the preferred entry point.
- Keep `CLAUDE.md` and `GEMINI.md` as pointer files only.

### Built artifact discipline

The published package and binary run from `dist/`, not `src/`. Any command-surface or manifest change must keep the compiled artifact in parity with source.

- Run `npm run build` before opening or updating a PR.
- Run `npm run verify:contract` when command contracts or machine-mode behavior change.
- Run `npm run verify:dist` to check compiled-artifact parity.
- Run `npm run verify:prepublish` before release work or when touching package/docs/manifest/help surfaces.
- `verify:prepublish` rebuilds first, then smoke-checks `package.json`, `npm pack --dry-run`, `README.md`, `node dist/index.js --help`, `node dist/index.js manifest`, `node dist/index.js context --json`, and `@purveyors/cli/manifest` self-import parity.
- Do not assume source-level tests cover the built artifact or the packaged export surface.

## Common Gotchas

- `catalog_id` is not the same as inventory `id`. Never mix them.
- `tasting get <bean-id>` uses a `catalog_id` (coffee_catalog row). It is NOT an inventory ID.
- `tasting rate [bean-id]` uses an `inventory id` (green_coffee_inv.id). It is NOT a catalog ID.
- `roast --coffee-id` expects an inventory ID, not a catalog ID.
- `sales --roast-id` expects a roast ID, not an inventory ID or catalog ID.
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

## Docs Audit Checklist

When doing a docs-only refresh, confirm these before opening a PR:

- README command reference matches `src/commands/*` and `src/lib/manifest.ts`.
- Auth and role claims match the actual `requireAuth` boundary: catalog is viewer, with `catalog search` structured processing filters elevated to member; inventory, roast, sales, and tasting are member; auth, config, context, and manifest are local or unauthenticated.
- Headless OAuth remains documented as first-class, not as a fallback.
- `purvey manifest` is documented as the preferred shell contract; `purvey context --json` is documented as compatibility.
- `@purveyors/cli/manifest` and package subpath exports are documented as supported in-process contracts.
- Live docs links point to `/docs/cli/overview` and `/docs/api/overview`.

## PR Checklist

Before opening or updating a PR:

- `npm run build`
- `npm run verify:contract`
- `npm run verify:dist`
- `npm run verify:prepublish`
- `npm run check`
- `npm run lint`
- `npm test`
- audit README, AGENTS, CLAUDE, GEMINI, CLI_STRATEGY, help text, manifest/context contract files, and dist artifact smoke checks for drift

Documentation-only PRs should still leave the command docs internally consistent.
