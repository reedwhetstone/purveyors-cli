# AGENTS.md

Canonical contributor guide for `@purveyors/cli`.

Use this file as the single maintained guide for humans and agents. `CLAUDE.md` should point here.

## Project Snapshot

- Package: `@purveyors/cli`
- Binary: `purvey`
- Runtime: Node.js 20+
- Stack: TypeScript, Commander.js, Supabase JS, Vitest
- Version source of truth: `package.json` and `purvey --version`

## Docs and Contract Surfaces

Live docs:

- Overview: <https://www.purveyors.io/docs/cli/overview>
- Agent integration: <https://www.purveyors.io/docs/cli/agent-integration>
- Catalog: <https://www.purveyors.io/docs/cli/catalog>
- Inventory: <https://www.purveyors.io/docs/cli/inventory>
- Roast: <https://www.purveyors.io/docs/cli/roast>
- Sales: <https://www.purveyors.io/docs/cli/sales>
- Tasting: <https://www.purveyors.io/docs/cli/tasting>

Machine-readable contract surfaces:

- `purvey context` for dense human-readable onboarding text
- `purvey context --json` for the compact manifest contract on stdout
- `purvey context --pretty` for indented manifest inspection
- `@purveyors/cli/manifest` for in-process `getCliManifest()` and `renderContextText()` access

Keep these surfaces aligned. If a command, flag, auth rule, ID type, or output contract changes, update the docs and the manifest together.

## What the CLI Covers

Current command groups:

- `auth`: `login`, `status`, `logout`
- `catalog`: `search` (filters: origin, process, price-min/max, flavor, name, supplier, ids, stocked, variety, drying-method, stocked-days, sort, offset, limit), `get <id>`, `stats`, `similar <id>`
- `inventory`: `list` (filters: stocked, catalog-id, purchase-date-start, purchase-date-end, origin, limit, offset), `get <id>`, `add`, `update <id>`, `delete <id>` (--force for cascade delete)
- `roast`: `list` (filters: coffee-id, roast-id, batch-name, coffee-name, date-start, date-end, stocked, catalog-id, limit, offset), `get <id>`, `create`, `update <id>`, `delete <id>`, `import [file]`, `watch [directory]`
- `sales`: `list` (filters: roast-id, date-start, date-end, buyer, limit, offset), `record`, `update <id>`, `delete <id>`
- `tasting`: `get <bean-id>`, `rate [bean-id]`
- `config`: `list`, `get <key>`, `set <key> <value>`, `reset`
- `context`: dense agent reference for the CLI

If you change this surface, update all of these in the same PR:

1. `README.md`
2. `AGENTS.md`
3. `CLAUDE.md` link or pointer
4. `src/commands/context.ts`
5. `src/lib/manifest.ts`
6. command help text in `src/commands/*` and `src/index.ts` when affected
7. `tests/manifest.test.ts` when the contract surface changes

## Local Setup

```bash
pnpm install
npm run build
npm run check
npm run lint
npm test
```

Use `pnpm install` for local setup. Use the package scripts for validation.

## Architecture

```text
src/
  index.ts            top-level program, global options, command registration
  commands/           Commander command trees and help text
  lib/                Supabase access, output, auth guards, business logic
  types/              shared TypeScript types
tests/                Vitest coverage
```

Command files:

- `auth.ts`: browser and headless OAuth, status, logout
- `catalog.ts`: catalog search, fetch, stats, similar-bean lookup
- `inventory.ts`: personal green coffee inventory CRUD
- `roast.ts`: roast CRUD, Artisan import, watch mode
- `sales.ts`: sales CRUD
- `tasting.ts`: tasting lookup and cupping scores
- `config.ts`: local CLI config
- `context.ts`: dense agent-oriented reference output

## Contribution Rules

### Package exports and integration entry points

- `@purveyors/cli/manifest` is the canonical in-process contract surface for agents and wrappers.
- `@purveyors/cli/lib` re-exports the main library helpers.
- Subpath exports like `@purveyors/cli/catalog` and `@purveyors/cli/inventory` should stay documented when exports change.
- If `package.json#exports` changes, update README, AGENTS, and the manifest in the same PR.

### Auth and roles

- Use `requireAuth('viewer')` for catalog commands and other viewer-level access.
- Use `requireAuth('member')` for personal data and writes.
- `catalog`, `inventory`, `roast`, `sales`, and `tasting` require authentication. Local `config` commands do not.
- Keep docs aligned with actual handler behavior. If auth requirements change, update README, help text, and context in the same PR.
- Exit code `3` is returned on any auth failure (not logged in, expired session, or insufficient role).

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
- `auth status` is the intentional exception: in machine mode it can emit structured auth-state JSON on stdout even when unauthenticated.

### Help text

- Every command should have real examples.
- Keep examples copy-pasteable.
- Do not document flags that are not wired in code.
- Do not leave stale release numbers or command names in help text.

### Docs discipline

This repo has several documentation surfaces that drift easily. When changing commands, options, auth behavior, output behavior, or package exports, audit the full set rather than patching one file. Live docs on `purveyors.io/docs/cli/*` should point at the same reality as the README and manifest.

## Common Gotchas

- `catalog_id` is not the same as inventory `id`. Never mix them.
- `tasting get <bean-id>` uses a `catalog_id` (coffee_catalog row). It is NOT an inventory ID.
- `tasting rate [bean-id]` uses an `inventory id` (green_coffee_inv.id). It is NOT a catalog ID.
- `roast --coffee-id` expects an inventory ID, not a catalog ID.
- `sales --roast-id` expects a roast ID, not an inventory ID or catalog ID.
- `context.ts` is easy to forget when command flags change, but `src/lib/manifest.ts` is the deeper source of truth for that command.
- `inventory list`, `roast list`, and `sales list` all support `--offset` for pagination. Keep docs in sync when adding new list flags.
- Catalog commands require viewer auth. Downstream docs (coffee-app site, etc.) that claim catalog access is unauthenticated are wrong and should align with this repo.
- `auth status` is the one deliberate output-mode exception. It can emit structured auth-state JSON on stdout even when unauthenticated.
- `CLAUDE.md` should remain a pointer-only symlink to this file, not a second maintained guide.

## Release Notes

- Keep the version in `package.json` authoritative.
- After merge, tag `vX.Y.Z` to publish to npm through GitHub Actions.
- Do not rely on hardcoded version strings in docs when they can drift.

## PR Checklist

Before opening or updating a PR:

- `npm run build`
- `npm run check`
- `npm run lint`
- `npm test`
- audit README, AGENTS, help text, and context for drift

Documentation-only PRs should still leave the command docs internally consistent.
