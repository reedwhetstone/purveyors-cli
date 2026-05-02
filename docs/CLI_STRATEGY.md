# Purveyors CLI Architecture Retrospective

_Created: 2026-03-14_
_Refreshed: 2026-04-28_
_Status: Historical architecture note for the shipped `purvey` CLI_

## Why this file exists

This document preserves the intent behind the original CLI strategy work, while describing what the repository actually ships today. The original draft was forward-looking and included ideas that are no longer current. This refreshed version is the maintained historical and architecture reference for the repo.

## What shipped

The repository now ships a TypeScript CLI named `purvey`, published as `@purveyors/cli`.

The product stance needs to stay explicit: this CLI is not just a developer utility.
It is a core agent surface. The website, chat tooling, and internal automation all
depend on the same exported functions and machine-readable contract, so CLI clarity
and reliability are product requirements, not optional DX polish.

Current command groups:

- `auth`: `login`, `status`, `logout`
- `catalog`: `search`, `get`, `stats`, `similar`
- `inventory`: `list`, `get`, `add`, `update`, `delete`
- `roast`: `list`, `get`, `create`, `update`, `delete`, `import`, `watch`
- `sales`: `list`, `record`, `update`, `delete`
- `tasting`: `get`, `rate`
- `config`: `list`, `get`, `set`, `reset`
- `context`: dense human-readable reference, plus manifest-compatible JSON with `--json` or `--pretty`
- `manifest`: preferred machine-readable CLI contract

The command surface is implemented explicitly in `src/program.ts` and `src/commands/*.ts`. It is not generated dynamically at runtime.

## Agent-first product stance

The shipped CLI should be judged by these rules:

1. **Agents are primary users of the machine surface.** Human terminal use matters,
   but command naming, argument clarity, manifest metadata, error envelopes, and
   output semantics should optimize first for reliable machine use.
2. **The website is downstream from the same functions.** If the CLI is awkward or
   ambiguous for an agent, that weakness leaks into the shared product layer.
3. **Shared workflow changes should be dogfooded through the CLI directly.** Do not
   treat web-only validation as sufficient for code that flows through `@purveyors/cli`.
4. **Human ergonomics are layered on top of a machine-clear contract.** Pretty output,
   prompts, and reference text should complement, not replace, explicit and stable
   machine behavior.

## Original strategy ideas that are no longer current

The March 2026 draft captured several useful product instincts, but some proposals do not match the shipped CLI:

- The binary is `purvey`, not `pvrs`.
- Authentication is Google OAuth through purveyors.io, not CLI API-key auth.
- There are no `workspace` commands in the shipped CLI.
- The CLI surface is not discovery-driven or auto-generated from an API schema.
- This repo does not ship a shared-types-package plan as part of the CLI contract.
- The maintained machine-readable contract is `purvey manifest`, with `purvey context --json` kept for parity and compatibility.

Those ideas may still be useful as future exploration themes, but they are not part of the current documented product surface and should not appear in maintained user-facing docs as if they are shipped.

## Current architecture

### Source of truth

Authority order for the shipped contract:

1. `src/program.ts`, `src/commands/*.ts`, and `src/lib/manifest.ts` define behavior, help text, command metadata, ID guidance, and rendered context.
2. `package.json` defines versioning, scripts, the binary entrypoint, Node engine, and package exports.
3. `README.md`, `AGENTS.md`, and this file explain how to use and maintain the contract.
4. Live product docs on purveyors.io are the external reference surface.

When documentation or help text needs verification, use these files first:

- `src/program.ts` for top-level program description, global options, and docs links
- `src/commands/*.ts` for command names, arguments, flags, examples, and auth expectations
- `src/commands/context.ts` for the human-readable reference command
- `src/commands/manifest.ts` for the manifest command contract
- `src/lib/manifest.ts` for shared manifest metadata, reference text, ID guidance, and workflows
- `package.json` for package metadata, scripts, binary entrypoint, Node engine, and exported subpaths

### Auth and roles

The shipped auth model is role-based:

- No pre-existing session required: `auth`, `config`, `context`, `manifest`
- Authenticated `viewer` role required: `catalog`
- Authenticated `member` role required: `inventory`, `roast`, `sales`, `tasting`

Google OAuth is available in two supported flows:

- `purvey auth login` for local interactive browser-based sign-in. It listens for the localhost callback and also offers a pasted-callback fallback when the browser lands on a URL the CLI cannot receive. Invalid pasted callback URLs are ignored and retried while the listener remains active.
- `purvey auth login --headless` for agents, CI, and remote machines

The headless path is a first-class supported environment, not a fallback edge case.
Auth changes that preserve browser UX but degrade headless agent usability should be
treated as product regressions.

Credentials are stored locally in `~/.config/purvey/credentials.json`.

### Artisan path and watch behavior

`roast import` and `roast watch` normalize file and directory path input before filesystem access. They trim whitespace, remove one matching layer of single or double quotes, and unescape common shell-escaped characters so pasted paths from terminals and file pickers behave predictably.

`roast watch` is a long-running operator workflow. It reacts only to new `.alog` files, saves session state for `--resume`, and treats Ctrl+C or SIGTERM as graceful shutdown signals that wait for active imports, commit queued batch-mode roasts, and print a verification summary.

### Output and reference surfaces

The CLI is designed for both humans and automation:

- Most successful command output is compact JSON on stdout by default.
- `--pretty` renders formatted JSON for humans.
- `--csv` is supported on array-shaped results for supported commands.
- Operational messaging stays on stderr.
- Fatal errors stay on stderr, with structured JSON error envelopes in machine-oriented modes.
- When human and machine ergonomics conflict, the contract should preserve machine
  clarity first and layer human affordances on top.

Reference surfaces:

- `purvey manifest` is the preferred shell-level machine-readable contract.
- `purvey context` is the dense human-readable reference.
- `purvey context --json` emits the same JSON as `purvey manifest`, but is maintained for compatibility with existing wrappers and parity checks.
- `@purveyors/cli/manifest` exposes the same contract in-process for Node.js consumers.
- `@purveyors/cli/catalog`, `/inventory`, `/roast`, `/sales`, `/tasting`, `/lib`, `/manifest`, `/artisan`, and `/ai` expose the shared function layer used by agents and the website.

Package export changes are product changes. They need the same care as CLI command changes because coffee-app and agent runtimes consume those paths directly.

### Data and ID boundaries

The shipped CLI distinguishes ID types carefully:

- `catalog_id`: `coffee_catalog` rows
- `inventory id`: `green_coffee_inv.id`
- `roast_id`: `roast_data.roast_id`
- `sale id`: `coffee_sales.id`

Important command boundaries:

- `tasting get <bean-id>` expects a `catalog_id`
- `tasting rate [bean-id]` expects an inventory ID
- `roast --coffee-id` expects an inventory ID
- `sales --roast-id` expects a roast ID

Maintained docs should call out these distinctions explicitly because they are a common source of operator and agent mistakes.

## Why the shipped approach still matches the original goal

The original draft aimed for a single, scriptable coffee intelligence interface. The shipped CLI still accomplishes that, even without runtime command generation.

It provides:

- one stable binary for operators, scripts, and agents
- a documented auth and role model
- explicit machine-readable and human-readable reference surfaces
- reusable in-process exports for catalog, inventory, roast, sales, tasting, shared library helpers, manifest, Artisan import, and AI workflows
- a first-class headless OAuth path for agents, CI, SSH sessions, and remote containers
- compiled artifact checks that keep the published package aligned with source
- a shared execution layer whose ergonomics directly affect the website and agent
  product surfaces

In other words, the product value came from a disciplined CLI contract, not from the specific `pvrs` naming or dynamic-discovery ideas proposed early on.

## Maintained documentation rules

When the command surface, output behavior, auth model, IDs, or docs links change, update the maintained docs set together:

1. `README.md`
2. `AGENTS.md`
3. `CLAUDE.md` and `GEMINI.md` pointer files
4. `docs/CLI_STRATEGY.md`
5. `src/commands/context.ts`
6. `src/commands/manifest.ts`
7. `src/lib/manifest.ts`
8. help text in `src/program.ts` and affected command files
9. compiled artifact validation after `npm run build`

For shared workflow changes, also test the CLI or exported function directly instead
of relying only on website flows. The CLI is part of the core product contract.

Docs refreshes should keep headless auth, manifest-first machine discovery, context as readable operator reference, and exported subpaths legible as one system rather than separate conveniences.

## Live docs links

When pointing users to live documentation, prefer the specific purveyors.io docs surfaces:

- CLI docs: <https://purveyors.io/docs/cli/overview>
- API docs: <https://purveyors.io/docs/api/overview>

Use GitHub for repository context, issues, and source, not as the primary live product documentation link.
