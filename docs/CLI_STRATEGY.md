# Purveyors CLI Architecture Retrospective

_Created: 2026-03-14_
_Refreshed: 2026-10-01_
_Status: Historical architecture note for the shipped `purvey` CLI_

## Why this file exists

This document preserves the intent behind the original CLI strategy work, while describing what the repository actually ships today. The original draft was forward-looking and included ideas that are no longer current. This refreshed version is the maintained historical and architecture reference for the repo.

## What shipped

The repository now ships a TypeScript CLI named `purvey`, published as `@purveyors/cli`.

The product stance needs to stay explicit: this CLI is not just a developer utility.
It is a core agent surface. CLI clarity and reliability are product requirements,
not optional DX polish. The CLI and coffee-app are separate consumers of
`@purveyors/sdk`; the website does not import CLI functions.

Current command groups:

- `auth`: `login`, `status`, `whoami`, `logout`
- `catalog`: `search`, `get`, `stats`, `facets`, `rank`, `rank-premium`, `supplier-list`, `supplier-detail`, `supplier-rank`, `similar`
- `market`: `signals`, `stats`, `metadata`, `overview`, `evidence` for Market Index decision-surface reads through `@purveyors/sdk`
- `price-index`: Parchment Price Index aggregate snapshots, plus `comparisons`, `comparison`, and `history` for matched 30-day comparisons with verbatim significance and chart history, through `@purveyors/sdk`
- `procurement`: saved sourcing brief reads and matches through `@purveyors/sdk`
- `reference-profile`: Studio reference list, import, chart, compare, preview, save, and export, plus `roasts`, `preview-from-roast`, and `from-roast` for planning from roast history, through `@purveyors/sdk`
- `inventory`: `list`, `get`, `add`, `update`, `delete`
- `roast`: `list`, `get`, `chart`, `create`, `update`, `delete`, `import`, `from-reference`, `watch`
- `roast-batch`: `list`, `get`, `create`, `update`, `delete` by batch ID, through the canonical SDK roast batch endpoints
- `sales`: `list`, `record`, `update`, `delete` through canonical SDK sales, roast, and roast batch endpoints
- `tasting`: `get`, `rate`
- `config`: `list`, `get`, `set`, `reset`
- `context`: dense human-readable reference, plus manifest-compatible JSON with `--json` or `--pretty`
- `manifest`: preferred machine-readable CLI contract
- `skill`: `print` and `install` for agent instructions rendered from the manifest: a skill folder (SKILL.md plus workflows.md) or an AGENTS.md block

The command surface is implemented explicitly in `src/program.ts` and `src/commands/*.ts`. It is not generated dynamically at runtime.

## Web-agent parity

The CLI must be able to do everything the Purveyors web assistant (Cherry) can do through the
Parchment SDK. It may do more, never less. The web assistant reads through a
`ParchmentClient`-shaped adapter in Parchment and writes through session-only confirmed
actions that API keys cannot call, so parity is defined per capability:

- every SDK method the assistant can call is consumed by at least one CLI command, declared in
  that command's manifest `sdkMethods`
- every confirmed action has an API-key command that performs the same write, declared in its
  manifest `confirmedActionEquivalents`

`tests/web-agent-parity.test.ts` enforces this against `CHAT_AGENT_CAPABILITIES` and
`CHAT_AGENT_CONFIRMED_ACTION_TYPES`, which Parchment owns and publishes in `@purveyors/sdk`.
When an SDK upgrade gives the assistant a capability, the test fails until a command covers it.
There are no documented exceptions: every published capability and confirmed action has a
command. `roast from-reference` performs `create_roast_from_reference`, and
`reference-profile from-roast --artisan-source` followed by `reference-profile save` performs
the roast-based `create_generated_reference`.

The CLI is ahead of the assistant on roast batches. Parchment publishes the five
`roastBatches` SDK methods but excludes them from the assistant's capability list, and the
`roast-batch` commands, `roast watch`, and `sales record` already consume them. When the
assistant gains a batch lookup tool and `roastBatches.list` and `roastBatches.get` join the
list, the parity test is already satisfied.

## Agent-first product stance

The shipped CLI should be judged by these rules:

1. **Agents are primary users of the machine surface.** Human terminal use matters,
   but command naming, argument clarity, manifest metadata, error envelopes, and
   output semantics should optimize first for reliable machine use.
2. **The API contract is the shared boundary.** Parchment owns shared data behavior
   and the OpenAPI contract. The SDK turns that contract into typed calls for both
   the CLI and coffee-app without coupling either consumer to the other.
3. **CLI workflow changes should be dogfooded through the CLI directly.** Web-only
   validation does not prove that CLI flags, output, auth, or local workflows work.
4. **Human ergonomics are layered on top of a machine-clear contract.** Pretty output,
   prompts, and reference text should complement, not replace, explicit and stable
   machine behavior.

## Original strategy ideas that are no longer current

The March 2026 draft captured several useful product instincts, but some proposals do not match the shipped CLI:

- The binary is `purvey`, not `pvrs`.
- Authentication uses Google OAuth through purveyors.io to bootstrap a scoped CLI API key.
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
4. CLI guides on purveyors.io and the generated API reference at `https://api.purveyors.io/docs` are the external reference surfaces.

When documentation or help text needs verification, use these files first:

- `src/program.ts` for top-level program description, global options, and docs links
- `src/commands/*.ts` for command names, arguments, flags, examples, and auth expectations
- `src/commands/context.ts` for the human-readable reference command
- `src/commands/manifest.ts` for the manifest command contract
- `src/lib/manifest.ts` for shared manifest metadata, reference text, ID guidance, and workflows
- `src/lib/agent-skill.ts` for the agent skill (SKILL.md and workflows.md) and AGENTS.md block rendered from that manifest, and their install locations
- `package.json` for package metadata, scripts, binary entrypoint, Node engine, and exported subpaths

### Auth and roles

The shipped auth model is role- and scope-based:

- No pre-existing credentials required: `auth`, `config`, `context`, `manifest`, `skill`
- Authenticated `viewer` role required: `catalog`
- Mixed public and entitled access: `market` and `price-index history` public teaser slices are unauthenticated; filtered market slices, `market evidence`, price-index comparisons, and history windows over 90 days require Parchment Intelligence access enforced server-side; `market overview` requires any signed-in session or API key
- Authenticated `member` role plus Studio entitlement required: `reference-profile`, enforced by Parchment
- Authenticated `member` role required through the stored scoped key: `price-index` snapshots, `price-index comparisons`, `price-index comparison`, `procurement`, `inventory`, `roast`, `roast-batch`, `sales`, `tasting`

Parchment device authorization exposes the existing purveyors.io Google login in two supported flows:

- `purvey auth login` opens the purveyors.io approval page and polls Parchment until the user approves it. Browser-open failure prints the URL and continues polling.
- `purvey auth login --headless` prints the same approval URL for agents, SSH sessions, and remote machines; approval can happen in any browser and no callback URL is pasted back.

The headless path is a first-class supported environment, not a fallback edge case.
Auth changes that preserve browser UX but degrade headless agent usability should be
treated as product regressions.

Credentials are stored locally in `~/.config/purvey/credentials.json`.

Canonical Parchment API surfaces also accept `PARCHMENT_API_KEY` (or the legacy
`PURVEYORS_API_KEY` alias). The environment key takes precedence over the scoped API key
created by `purvey auth login` and must carry the endpoint's owner-bound read or write
scope. The request token and PKCE verifier are transient bootstrap material only; the CLI stores neither.

### Artisan path and watch behavior

`roast import` and `roast watch` normalize file and directory path input before filesystem access. They trim whitespace, remove one matching layer of single or double quotes, and unescape common shell-escaped characters so pasted paths from terminals and file pickers behave predictably.

`roast watch` is a long-running operator workflow. It reacts only to new `.alog` files, saves session state for `--resume`, and treats Ctrl+C or SIGTERM as graceful shutdown signals that wait for active imports, commit queued batch-mode roasts, and print a verification summary. Batch commit mode saves every roast from the session into one batch record; individual commit mode gives each roast its own numbered batch.

### Roast batch identity

A roast batch is a record in Parchment with its own ID, a display name, and a date
([PADR-0029](https://github.com/reedwhetstone/parchment-api/blob/main/docs/adr/PADR-0029-roast-batch-identity.md)).
Names repeat, so the CLI refers to a batch by ID wherever it means one batch:

- `roast watch` in batch commit mode opens one batch per session through `roastBatches.create`,
  keeps the ID in the saved session state, and sends it as `batchId` with every import. The
  session is one batch when its name was used before and when it runs past midnight, and
  `--resume` reuses the stored ID. The batch is opened when the first roast is saved, so a
  session that sees no files creates nothing.
- A session file written before batch IDs holds only the name. Those roasts were grouped by name
  and roast date, so on `--resume` the CLI reads the batch of the first saved roast and continues
  there. It reports, and does not move, any roasts of the session that are in another batch.
- If the session opened a batch and saved no roast into it, the CLI reads the batch back and
  deletes it only when it is empty. Deleting a batch deletes its roasts, so the read is the
  safeguard; a batch the session joined is never removed.
- Files the session could not match to a coffee are imported by hand. The command the CLI prints
  for them carries the session's batch ID, read back first when it came from a saved session and
  no roast of this run confirmed it. A session with no batch, because no roast was saved, prints
  the `roast-batch create` command to run first. The CLI does not open a batch for those files
  itself: one that is never used would stay behind empty.
- Individual commit mode writes each roast with a numbered name and no batch ID, which is
  Parchment's supported way to write without opening a batch first. Each roast is its own batch.
- `--batch-id` on `roast create`, `roast import`, `roast from-reference`, and `roast update`
  places a roast in an existing batch whatever its date. `--batch-name` keeps Parchment's
  name-and-date placement. The CLI refuses both together instead of dropping the name.
- `sales record` sends `batchId`, and `roastId` only when the seller named a roast with
  `--roast-id`. A roast is never inferred from a batch. The name-based selector resolves to a
  batch ID first and refuses, listing each candidate batch ID with its date, when the name
  matches more than one batch that holds the coffee.

The deprecated name-based batch routes (`roasts.createBatch`, `roasts.deleteBatch`) have no CLI
caller.

Both `roast import` and `roast watch` forward the original `.alog` source to Parchment. Parsing, validation, normalization, and persistence are canonical server-side responsibilities; the CLI must not maintain a second Artisan parser or reinterpret profile data locally.

### Studio reference planning

`reference-profile` consumes the published Parchment SDK for owner-scoped reference list,
upload, chart, preview, save, and export operations. Parchment owns source parsing,
revision calculation, lineage, entitlement checks, persistence, and export serialization.
The CLI validates the bounded request shape but does not transform chart data or generate
`.alog` content. `reference-profile compare` resolves `profile:` and bare `roast:` selectors to
their current immutable revisions through Parchment, then returns the canonical comparison
envelope unchanged. Generated references remain plans outside executed roast history; exports
are unsigned, and the CLI does not claim verified Artisan 4.2 playback compatibility.

Planning from roast history uses the same boundary. `reference-profile roasts` lists the roasts
whose Artisan file Parchment has on record, `preview-from-roast` previews a plan on one of them,
and `from-roast --artisan-source` saves that file as an owner-scoped reference that `save` and
`export` then build on. Parchment decides which roasts are eligible and reads the stored file;
the CLI sends a roast ID and revision and returns the response unchanged. When `--roast-revision`
is omitted the CLI reads the roast's current revision through `roasts.get`, the only extra call.
A roast with no stored file returns Parchment's `roast_artisan_source_unavailable` message, which
the CLI relays with exit 2. `roast from-reference` is the reverse direction and the only one that
creates a roast; Parchment refuses generated plans and references saved from a roast, so a plan
is never recorded as a roast that was run.

### Output and reference surfaces

The CLI is designed for both humans and automation:

- Most successful command output is compact JSON on stdout by default.
- `--pretty` renders formatted JSON for humans.
- `--csv` is supported on array-shaped results for supported commands.
- Operational messaging stays on stderr.
- Fatal errors stay on stderr, with structured JSON error envelopes in machine-oriented modes.
- When human and machine ergonomics conflict, the contract should preserve machine
  clarity first and layer human affordances on top.

Catalog intelligence boundaries:

- `catalog search --include-proof` consumes the canonical `/v1/catalog?include=proof` summary. The CLI does not compute proof scores locally.
- The proof path consumes the same canonical `/v1/catalog` query contract as ordinary catalog search. The CLI does not expose client-only filters or locally reinterpret proof results.
- `catalog similar <id>` consumes the beta canonical `/v1/catalog/{id}/similar` contract, not the legacy direct RPC path. Parchment decides access: it admits member and admin sessions and any customer API key with `catalog:read`, on any API plan. The `purvey auth login` key carries that scope, so the CLI sends it without a role pre-check and maps Parchment's 401/403 to exit code 3.
- Similarity output must keep `canonical_candidates` separate from `similar_recommendations` and preserve blocker, proof, pricing, score-dimension, `classification_version`, and `query_strategy` metadata for agents.
- Structured process filters map to canonical `/v1/catalog` query names. Parchment grants them to member sessions and any customer API key, so the CLI does not pre-check roles for them.
- `catalog search --supplier`, `--drying-method`, and `--flavor`, and `catalog rank --supplier`, pass through to canonical query parameters (`supplier`, `dryingMethod`, `flavorKeywords`); Parchment applies them. See the 2026-10-01 update in ADR-004.
- `catalog facets` returns Parchment's counted facets and metadata unchanged. It does not truncate, re-count, or sum facet counts.
- Catalog reads and intelligence helpers, inventory CRUD, roast CRUD and classification, reference-profile operations, sales CRUD, tasting reads and writes, role resolution, `market`, `price-index`, and `procurement` are SDK-backed canonical API operations. They default to `api.purveyors.io` and accept `PARCHMENT_API_BASE_URL` for alternate deployments. Most surfaces use `PARCHMENT_API_KEY`/`PURVEYORS_API_KEY` when provided and otherwise send the scoped API key created by `purvey auth login`; interactive roast auto-classification pins that logged-in identity so its inventory candidates and owner-bound classifier authorization cannot diverge. Owner data requires the matching owner-bound API-key scope. `catalog:read` is the canonical scope for catalog, Market Index, Price Index, and procurement reads. Market and price-index history public teaser slices are unauthenticated; filtered and non-public market slices, market evidence, price-index comparisons, and history windows over 90 days require Parchment Intelligence access enforced server-side.
- Procurement brief creation is intentionally absent from the CLI read surface until the Phase 2 write contract ships.

Reference surfaces:

- `purvey manifest` is the preferred shell-level machine-readable contract.
- `purvey context` is the dense human-readable reference.
- `purvey context --json` emits the same JSON as `purvey manifest`, but is maintained for compatibility with existing wrappers and parity checks.
- `@purveyors/cli/manifest` exposes the same contract in-process for Node.js consumers.
- `purvey skill print` renders agent instructions from the manifest rather than from hand-written prose, so they cannot drift from the contract. The skill is two files: `SKILL.md`, which agents load whenever the skill triggers and which stays small (tests cap it at 8 KB), and `workflows.md`, the step-by-step workflows that `SKILL.md` indexes and links to, which agents read only before a multi-step task. New manifest workflows grow `workflows.md`, not `SKILL.md`. `purvey skill install` places the skill where Claude Code (`~/.claude/skills/`) or Agent Skills clients such as Codex and Cursor (`~/.agents/skills/`) load it, or adds a compact block to a repository `AGENTS.md`. It writes safely, file by file: identical content is left alone, unedited earlier output is updated, a missing `workflows.md` is created, and local edits need `--force`. Because Claude Code reads `AGENTS.md` only when no `CLAUDE.md` sits on the project path, the `agents-md` target reports whether Claude Code will see its block and links it through an `@AGENTS.md` import only when asked (`--link-claude-md`).
- `@purveyors/cli/catalog`, `/market`, `/inventory`, `/roast`, `/sales`, `/tasting`, `/lib`, `/manifest`, and `/cherry` expose reusable CLI-package functions for intentional in-process consumers. `/ai` remains a deprecated compatibility re-export of `/cherry`. Coffee-app uses `@purveyors/sdk` directly.

Package export changes are product changes for supported CLI-package consumers. They do not define the coffee-app integration contract.

### Data and ID boundaries

The shipped CLI distinguishes ID types carefully:

- `catalog_id`: `coffee_catalog` rows
- `inventory id`: `green_coffee_inv.id`
- `roast_id`: `roast_data.roast_id`
- `batch_id`: `roast_batches.id` (a UUID)
- `sale id`: `coffee_sales.id`

Important command boundaries:

- `tasting get <bean-id>` expects a `catalog_id`
- `tasting rate [bean-id]` expects an inventory ID
- `roast --coffee-id` expects an inventory ID
- `sales list --coffee-id` expects an inventory ID; `sales record --roast-id` expects a roast ID
- a sale refers to an inventory item and a batch by ID, and to one roast only when the seller named it; batch names repeat, so a name is a selector that must resolve to exactly one batch

Maintained docs should call out these distinctions explicitly because they are a common source of operator and agent mistakes.

## Why the shipped approach still matches the original goal

The original draft aimed for a single, scriptable coffee intelligence interface. The shipped CLI still accomplishes that, even without runtime command generation.

It provides:

- one stable binary for operators, scripts, and agents
- a documented auth and role model
- explicit machine-readable and human-readable reference surfaces
- reusable in-process exports for catalog, inventory, roast, sales, tasting, shared library helpers, manifest, and AI workflows
- a first-class headless device-authorization path for agents, CI, SSH sessions, and remote containers
- compiled artifact checks that keep the published package aligned with source
- reusable in-process CLI functions for agents and Node.js callers that intentionally
  want CLI semantics

In other words, the product value came from a disciplined CLI contract, not from the specific `pvrs` naming or dynamic-discovery ideas proposed early on.

## Maintained documentation rules

When the command surface, output behavior, auth model, IDs, or docs links change, update the maintained docs set together:

1. `README.md`
2. `AGENTS.md`
3. `CLAUDE.md` and `GEMINI.md` pointer files
4. `docs/CLI_STRATEGY.md`
5. `src/commands/context.ts`
6. `src/commands/manifest.ts`
7. `src/lib/manifest.ts`, which also feeds the generated agent skill in `src/lib/agent-skill.ts`
8. help text in `src/program.ts` and affected command files
9. compiled artifact validation after `npm run build`

For CLI workflow changes, test the CLI or exported function directly instead of
relying only on website flows. The CLI is a core product surface, but not the
website's implementation layer.

Docs refreshes should keep headless auth, manifest-first machine discovery, context as readable operator reference, and exported subpaths legible as one system rather than separate conveniences.

## Live docs links

When pointing users to live documentation, prefer the specific purveyors.io docs surfaces:

- CLI docs: <https://purveyors.io/docs/cli/overview>
- API reference: <https://api.purveyors.io/docs>

Use GitHub for repository context, issues, and source, not as the primary live product documentation link.
