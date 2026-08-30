# purvey

Coffee intelligence from your terminal.

`purvey` is the official CLI for [purveyors.io](https://purveyors.io). It gives coffee professionals, developers, and AI agents direct access to the Purveyors platform from the terminal: catalog search, Market Index intelligence, price-index snapshots, procurement brief reads, inventory tracking, roast logging, sales records, tasting notes, and Artisan `.alog` import.

Use `purvey --help` for quick command discovery, `purvey context` for the dense human-readable operator reference, `purvey manifest` for the preferred machine-readable contract, or `@purveyors/cli/manifest` in-process.

## At a glance

- Official binary: `purvey`
- Package: `@purveyors/cli`
- Runtime: Node.js 20+
- No pre-existing credentials required: `auth`, `config`, `context`, `manifest`
- Viewer role required: `catalog` (excluding structured process filters on `catalog search`)
- Member role required: `price-index`, `procurement`, `inventory`, `roast`, `sales`, `tasting`
- Mixed public and entitled access: `market` public teaser slices are unauthenticated; filtered slices require Parchment Intelligence access
- Preferred machine-readable contract: `purvey manifest`
- Dense human-readable reference: `purvey context`
- Compatibility JSON alias: `purvey context --json`
- In-process machine contract: `@purveyors/cli/manifest`

## Installation

```bash
npm install -g @purveyors/cli
```

Requirements:

- Node.js 20 or newer

Verify the install:

```bash
purvey --version
```

## Documentation map

| Surface                                          | Use it for                                                |
| ------------------------------------------------ | --------------------------------------------------------- |
| <https://purveyors.io/docs/cli/overview>         | Live CLI docs                                             |
| <https://api.purveyors.io/docs>                  | Canonical generated API reference                         |
| [docs/ADR-INDEX.md](./docs/ADR-INDEX.md)         | Canonical CLI architecture decision registry              |
| [AGENTS.md](./AGENTS.md)                         | Canonical contributor and agent guidance                  |
| [docs/CLI_STRATEGY.md](./docs/CLI_STRATEGY.md)   | Historical architecture and shipped-surface retrospective |
| <https://github.com/reedwhetstone/purveyors-cli> | Repository, issues, and source                            |
| <https://www.npmjs.com/package/@purveyors/cli>   | Package installation and release metadata                 |

Use the live docs on purveyors.io as the primary external reference. Use this README and `AGENTS.md` for repo-specific contributor detail.

## Source-of-truth hierarchy

Use this hierarchy when references disagree:

1. `src/program.ts`, `src/commands/*`, and `src/lib/manifest.ts` define the shipped command surface, help text, auth requirements, output modes, ID guidance, and manifest payload.
2. `package.json` defines the package version, Node engine, binary entrypoint, scripts, and exported subpaths.
3. `README.md`, `AGENTS.md`, and `docs/CLI_STRATEGY.md` explain the repo-specific contract for users, contributors, and agents.
4. `https://purveyors.io/docs/cli/overview` is the primary CLI guide. `https://api.purveyors.io/docs` is the canonical generated API reference.

The CLI is an agent-first product surface. Treat the binary, exported functions, `purvey manifest`, `purvey context`, stdout/stderr behavior, and role-gated command boundaries as one contract.

## Quick Start

```bash
# 1. Authenticate before using catalog, market intelligence, inventory, roast, sales, or tasting commands
purvey auth login

# For agents, CI, or remote machines, use headless flow:
# purvey auth login --headless

# Headless login prints an approval URL. Approve it in any browser; the CLI completes automatically.

# 2. Confirm the stored API key and role
purvey auth status

# 3. Search the catalog (viewer role for basic filters, member role for structured process filters)
purvey catalog search --origin "Ethiopia" --stocked --pretty

# Example with structured process filters and proof output
purvey catalog search --origin "Ethiopia" --processing-base-method "Washed" --include-proof --pretty

# 4. Read a public Market Index teaser slice
purvey market signals --summary --pretty

# 5. Check inventory (requires member role)
purvey inventory list --stocked --pretty

# 6. Import a roast from Artisan
purvey roast import ~/artisan/my-roast.alog --coffee-id 7 --pretty

# 7. Get the machine-readable CLI contract
purvey manifest

# 8. Get the dense readable CLI reference
purvey context
```

## Reference surfaces

Use the right reference surface for the job:

- `purvey manifest` is the preferred stable machine-readable contract for agents, scripts, generated tooling, and parity checks.
- `purvey context` is the dense human-readable operator reference for reviewers and interactive use.
- `purvey context --json` and `purvey context --pretty` emit the same JSON payload as `purvey manifest`, but exist mainly for compatibility with tooling that already shells out to `context`.
- `@purveyors/cli/manifest` exposes the same contract in-process for Node.js and agent runtimes.

## Package exports and integration boundary

The npm package is both a binary and a reusable TypeScript surface for Node.js callers that specifically want CLI behavior. The CLI itself consumes `@purveyors/sdk`, which is the typed client for the canonical Parchment API. The SDK does not call or embed CLI functions.

`coffee-app` also consumes `@purveyors/sdk` directly. It does not depend on `@purveyors/cli`; the website chat tools and the CLI are separate adapters over the same API contract. Shared data behavior belongs in Parchment and its OpenAPI contract, while terminal concerns such as local credentials, flags, output modes, exit codes, Artisan file handling, and watch mode belong in this package.

| Import path                | Use it for                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `@purveyors/cli`           | CLI entrypoint package root                                                                    |
| `@purveyors/cli/catalog`   | Catalog search, lookup, stats, premium ranking, supplier aggregates, similar coffees           |
| `@purveyors/cli/market`    | Market Index value signals, movement stats, and metadata trends                                |
| `@purveyors/cli/inventory` | Green coffee inventory operations                                                              |
| `@purveyors/cli/roast`     | Roast profile operations                                                                       |
| `@purveyors/cli/sales`     | Sales record operations                                                                        |
| `@purveyors/cli/tasting`   | Tasting note and rating operations                                                             |
| `@purveyors/cli/lib`       | Shared library helpers                                                                         |
| `@purveyors/cli/manifest`  | Stable machine-readable CLI manifest                                                           |
| `@purveyors/cli/cherry`    | Primary Cherry roast-classification helper                                                     |
| `@purveyors/cli/ai`        | Deprecated compatibility re-export of `@purveyors/cli/cherry`; existing consumers keep working |

Shell integrations should usually start with `purvey manifest`. Node.js agents that specifically need CLI semantics may import the smallest relevant CLI subpath instead of shelling out. Application integrations should normally use `@purveyors/sdk` directly so the API contract, rather than the CLI package, remains the cross-surface boundary.

Export discipline:

- Add or remove subpaths only when the package contract intentionally changes.
- Keep `package.json`, `README.md`, `AGENTS.md`, `docs/CLI_STRATEGY.md`, `src/lib/manifest.ts`, and dist parity checks aligned in the same PR.
- Prefer the narrowest import path for agent code that intentionally consumes CLI semantics. For example, use `@purveyors/cli/catalog` instead of importing the package root.
- Treat export-shape changes as product changes for supported CLI-package consumers. They do not define the coffee-app integration contract.

## Authentication and access model

No pre-existing credentials are required for `auth`, `config`, `context`, or `manifest`.

Remote data commands require a valid owner-bound API key with the required scope:

- `catalog` requires the `viewer` role by default
- `catalog search` structured process filters require the `member` role
- `market` has public teaser slices for `signals --summary`, unfiltered retail `stats`, and process/retail/month `metadata`; all filtered or non-public slices require Parchment Intelligence access enforced server-side
- `price-index`, `procurement`, `inventory`, `roast`, `sales`, and `tasting` require the `member` role

`purvey` uses Google OAuth through purveyors.io.

Set `PARCHMENT_API_KEY` (or `PURVEYORS_API_KEY`) to authenticate SDK-backed catalog,
inventory, roast, sales, tasting-read, market, price-index, and procurement operations
without using the API key created by `purvey auth login`. Environment credentials take precedence.

Interactive login:

```bash
purvey auth login
```

Headless login for agents, CI, and remote machines:

```bash
purvey auth login --headless
# CLI prints a purveyors.io approval URL
# Open it in any browser, sign in, and approve access
# The CLI completes automatically
```

Both modes use Parchment's short-lived device authorization flow. The CLI keeps its PKCE verifier in memory, receives a scoped Parchment API key after browser approval, and never runs a localhost callback server or asks you to paste a callback URL. If browser launch fails, the interactive command prints the approval URL and keeps waiting.

Status:

```bash
purvey auth status
purvey auth status --json
purvey auth status --pretty
```

Logout:

```bash
purvey auth logout
```

Credentials are stored at `~/.config/purvey/credentials.json`.

### Auth roles

| Role     | Access                                                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | `catalog search`, `catalog get`, `catalog stats`, excluding structured process filters                                                                                                                                        |
| `member` | All viewer commands, `catalog similar`, structured process filters on `catalog search`, plus `price-index`, `procurement`, `inventory`, `roast`, `sales`, and `tasting` through the scoped key created by `purvey auth login` |

Market Index teaser slices are public. Filtered `market signals`, origin/process/wholesale `market stats`, and non-public `market metadata` slices require Parchment Intelligence access; API-key denial is enforced by the canonical API. The stored login key carries `catalog:read`, which is also the canonical read scope for Market Index, Price Index, and procurement.

`auth`, `config`, `context`, and `manifest` remain available without pre-existing credentials.

Commands that require a higher role exit with code `3` on auth failure. That includes missing, revoked, or invalid credentials and an insufficient role.

## Output contract and scripting

Most commands write compact JSON to stdout by default. Use `--json` if you want to request that mode explicitly.

Machine-contract rule of thumb: stdout is for successful payloads, stderr is for status or errors, and exit codes communicate the failure class. That rule is more important than making terminal output look conversational.

Pretty JSON:

```bash
purvey inventory list --pretty
```

CSV output for array results on supporting commands:

```bash
purvey inventory list --csv > inventory.csv
purvey roast list --csv > roasts.csv
purvey sales list --csv > sales.csv
```

Pipe JSON into `jq`:

```bash
purvey inventory list | jq '.[].id'
purvey roast list --limit 5 | jq '.[].roast_id'
purvey auth status 2>/dev/null | jq -r '.email'
```

Operational messages go to stderr so stdout stays script-friendly.

Fatal errors also stay on stderr, but the payload format depends on mode:

- interactive terminal with no explicit output flag: human-readable text
- `--json`, `--pretty`, or `--csv`: JSON error envelope on stderr
- piped or redirected with no explicit flag: compact JSON error envelope on stderr

That contract also applies to parser-level mistakes such as unknown options, unknown commands, and missing required arguments.

The JSON error envelope includes:

```json
{ "error": true, "code": "INVALID_ARGUMENT", "exitCode": 2, "message": "..." }
```

### Output caveats worth knowing

- `purvey auth status` prints human-readable output in an interactive terminal unless you pass `--json`, `--pretty`, or `--csv`. When piped or redirected, it emits structured JSON on stdout even when unauthenticated.
- `purvey config list/get/set/reset` stay human-readable in an interactive terminal, but emit JSON on stdout when you pass `--json` or `--pretty`, or when stdout is non-interactive. `--csv` is not supported for config commands.
- `purvey context` defaults to dense human-readable reference text. `--json` and `--pretty` make it emit the same JSON manifest as `purvey manifest`.
- `purvey manifest` always emits the machine-readable contract on stdout. `--pretty` only changes formatting.
- `--csv` affects successful stdout output only; fatal errors still use JSON on stderr.

## Exit codes

All `purvey` commands exit with a numeric code your scripts can check with `$?`.

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | Success                                                            |
| `1`  | Unexpected or unclassified error                                   |
| `2`  | Invalid argument or bad input                                      |
| `3`  | Auth error: missing, revoked, or invalid key; or insufficient role |
| `4`  | Not found                                                          |
| `5`  | Dependency conflict                                                |
| `6`  | Local config error                                                 |

Scripting pattern:

```bash
purvey catalog search --origin "Ethiopia" --stocked --json
if [ $? -eq 3 ]; then
  purvey auth login --headless
fi
```

## Command reference

### auth

- `purvey auth login`
- `purvey auth login --headless`
- `purvey auth status`
- `purvey auth status --json`
- `purvey auth status --pretty`
- `purvey auth status --csv`
- `purvey auth logout`

Examples:

```bash
purvey auth login
purvey auth login --headless
purvey auth status --pretty
purvey auth status --csv
purvey auth logout
```

Notes:

- `auth login` opens a short-lived purveyors.io approval request and completes automatically after approval. If browser launch fails, it prints the same URL and keeps polling.
- `auth login --headless` prints the approval URL without trying to open a local browser. Approve it from any browser; nothing is pasted back.
- `auth status --json` is the safest mode for scripts.
- `auth status --csv` is supported for spreadsheet-style checks, but JSON remains the better integration format.

### catalog

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
- `purvey catalog facets <field>`
- `purvey catalog rank`
- `purvey catalog rank-premium`
- `purvey catalog supplier-list`
- `purvey catalog supplier-detail <supplier>`
- `purvey catalog supplier-rank`
- `purvey catalog similar <id>`

`catalog search` filters:

- `--origin <text>`; origin, country, continent, or region
- `--process <method>`; processing method
- `--processing-base-method <method>`; canonical structured process base method
- `--fermentation-type <type>`; structured fermentation type
- `--process-additive <additive>`; disclosed process additive
- `--processing-disclosure-level <level>`; structured process disclosure level
- `--processing-confidence-min <n>`; minimum structured process confidence from `0` to `1`
- `--price-min <n>`; minimum USD/lb
- `--price-max <n>`; maximum USD/lb
- `--name <text>`; partial coffee name match
- `--ids <n,n,...>`; fetch specific catalog IDs, ignores limit and offset
- `--variety <text>`; partial cultivar match
- `--stocked-days <n>`; stocked within N days
- `--stocked`; only currently stocked coffees
- `--sort <price|price-desc|name|origin>`
- `--offset <n>`; pagination offset
- `--limit <n>`; default `10`, min `1`, max `1000`
- `--include-proof`; request canonical proof summaries from `/v1/catalog?include=proof`

`catalog similar <id>` options:

- `--threshold <score>`; canonical similarity threshold `0.5` to `0.99`, default `0.70`
- `--limit <count>`; default `10`, max `25`
- `--stocked-only`; request only currently stocked coffees
- `--mode <all|likely_same|similar_profile>`; default `all`

`catalog facets <field>` options:

- Fields: `supplier`, `country`, `processing_base_method`, `fermentation_type`, `drying_method`, `grade`, `wholesale`
- `--all`; use all visible catalog rows instead of the default stocked-only scope.
- `--limit <n>`; default `60`, max `100`

`catalog rank` options:

- `--objective <premium|value|fresh_arrival|rare_origin>`; default `premium`
- `--country <country>`; optional country filter
- `--process <method>`; optional process filter
- `--stocked`; only include currently stocked coffees. This is the default unless `--all` is passed.
- `--all`; use all visible catalog rows instead of the default stocked-only scope
- `--price-max <n>`; maximum USD/lb
- `--min-score <n>`; minimum Purveyor Score
- `--non-wholesale-only`; exclude wholesale listings at query time before sampling
- `--sample-size <n>`; rows to sample before ranking, default `5000`, max `5000`
- `--limit <n>`; default `10`, max `50`

`catalog rank-premium` options:

- `--origin <origin>`; optional origin filter
- `--process <method>`; optional process filter
- `--stocked`; only include currently stocked coffees
- `--price-max <n>`; maximum USD/lb
- `--min-score <n>`; minimum Purveyor Score
- `--include-unscored`; include unscored rows after scored rows
- `--sample-size <n>`; rows to sample before ranking, default `250`, max `5000`
- `--limit <n>`; default `10`, max `50`

`catalog supplier-*` options:

- `supplier-list`: `--country <country>`, `--stocked`, `--non-wholesale-only`, `--sample-size <n>` (catalog rows per fetch page, default `5000`, max `5000`), `--limit <n>`
- `supplier-detail <supplier>`: `--country <country>`, `--stocked`, `--non-wholesale-only`, `--top-coffees <n>`, `--sample-size <n>` (catalog rows per fetch page, default `5000`, max `5000`)
- `supplier-rank`: `--country <country>`, `--stocked`, `--non-wholesale-only`, `--min-coffees <n>` (min `1`, max `100`), `--sample-size <n>` (catalog rows per fetch page, default `5000`, max `5000`), `--limit <n>`

Examples:

```bash
purvey catalog search --origin "Ethiopia" --pretty
purvey catalog search --processing-base-method "Natural" --fermentation-type "Anaerobic" --pretty
purvey catalog search --process-additive "hops" --processing-confidence-min 0.8 --pretty
purvey catalog search --name "Gesha" --stocked --pretty
purvey catalog search --ids "1182,1183,1200"
purvey catalog search --stocked --sort price --offset 10 --limit 10
purvey catalog search --origin "Ethiopia" --include-proof --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey catalog search --origin "Ethiopia" --include-proof --limit 5 --json
purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
purvey catalog similar 1182 --json | jq '.data.groups.canonical_candidates'
purvey catalog facets supplier --pretty
purvey catalog rank --objective value --country Ethiopia --price-max 12 --json
purvey catalog rank-premium --stocked --limit 10 --pretty
purvey catalog supplier-rank --country Ethiopia --non-wholesale-only --min-coffees 3 --json
purvey catalog supplier-detail "Royal Coffee" --pretty
purvey catalog stats --pretty
purvey catalog get 1182 --pretty
purvey catalog get 1182 --include-proof --json
```

Notes:

- Catalog commands require an authenticated `viewer` role by default.
- Structured process filters on `catalog search` require an authenticated `member` role.
- Structured process filters use the canonical `/v1/catalog` query contract names while preserving the legacy `--process` label filter.
- `--include-proof` is an opt-in API-backed catalog read. It consumes the canonical proof summary returned by `/v1/catalog?include=proof`; the CLI does not compute proof fields locally or duplicate web/API proof logic.
- If you want proof output against a specific API-key deployment, set `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY`. Otherwise the CLI uses the key created by `purvey auth login`.
- `catalog get` and `catalog similar` both take `coffee_catalog.catalog_id`.
- `catalog rank` and `catalog rank-premium` read `coffee_catalog.purveyor_score` as the canonical quality signal; the CLI does not recompute the upstream Purveyor Score model.
- `catalog facets` and `catalog rank` are generic agent/client intelligence surfaces. Facet counts come from the canonical API across the selected stocked/all-visible scope; ranking responses include sample metadata so callers do not mistake sampled rarity for whole-catalog guarantees.
- Catalog intelligence responses include `meta.sample_limited`, `meta.sample_order`, `meta.truncated`, and rows-examined style metadata where relevant so agents can distinguish ranked samples from full supplier aggregates. Supplier aggregate responses also include `meta.rows_examined`.
- Supplier aggregate commands summarize catalog row counts, stocked counts, Purveyor Score coverage, average score, average confidence, price range, origin/process coverage, and representative top coffees with score qualifiers.
- `catalog similar` uses the beta canonical `/v1/catalog/{id}/similar` API contract, not the legacy direct RPC path.
- `catalog similar --json` requires member access or a paid API tier and returns the grouped canonical response object: `data.target`, `data.groups.canonical_candidates`, `data.groups.similar_recommendations`, optional `data.matches`, and `meta`.
- `canonical_candidates` are likely same-lot candidates; `similar_recommendations` are substitutes/profile matches and include blocker reasons when identity gates disagree.
- The command preserves `classification_version`, `query_strategy`, score dimensions, proof summaries, pricing metadata, and classification/blocker details supplied by the API.
- `catalog stats` returns aggregate catalog metrics, not your personal inventory metrics.

### price-index

- `purvey price-index`

`price-index` filters:

- `--origin <origin>`
- `--process <method>`
- `--grade <grade>`
- `--from <YYYY-MM-DD>`
- `--to <YYYY-MM-DD>`
- `--wholesale <true|false>`
- `--page <n>`; 1-based page number
- `--limit <n>`; results per page, min `1`, max `100`

Examples:

```bash
purvey price-index --pretty
purvey price-index --origin "Ethiopia" --from 2026-01-01 --to 2026-06-30 --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey price-index --limit 25 --json
```

Notes:

- `price-index` is backed by the canonical Parchment API `GET /v1/price-index` through `@purveyors/sdk`.
- Session-token use requires the local `member` role; API-key use is accepted via `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY` and PPI entitlement is enforced server-side.
- `PARCHMENT_API_BASE_URL` overrides the canonical API base for this SDK-backed command.

### market

- `purvey market signals`
- `purvey market stats`
- `purvey market metadata`

`market signals` filters:

- `--summary`; public counts-only teaser slice
- `--type <price_drop|below_market|value_quality>`; repeatable or comma-separated
- `--origin <origin>`
- `--process <method>`
- `--market <retail|wholesale|all>`
- `--min-discount <n>`
- `--min-score <n>`
- `--window <7d|30d>`
- `--limit <n>`; min `1`, max `100`

`market stats` filters:

- `--origin <origin>`
- `--process <method>`
- `--market <retail|wholesale|all>`
- `--window <7d|30d>`
- `--baseline-weeks <n>`; 8-52

`market metadata` filters:

- `--dimension <process|disclosure|score>`
- `--origin <origin>`
- `--market <retail|wholesale|all>`
- `--grain <week|month>`
- `--from <YYYY-MM-DD>`
- `--to <YYYY-MM-DD>`

Examples:

```bash
purvey market signals --summary --pretty
purvey market signals --type price_drop --origin "Ethiopia" --json
purvey market stats --pretty
purvey market metadata --dimension score --origin "Ethiopia" --grain month --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey market signals --market wholesale --json
```

Notes:

- `market` commands are backed by canonical Parchment API endpoints through `@purveyors/sdk`; the CLI does not compute Market Index intelligence locally.
- Public teaser slices: `signals --summary`, `stats` with no origin/process and `market=retail`, and `metadata` at dimension=process/no-origin/market=retail/grain=month.
- Any filtered or non-public market slice requires Parchment Intelligence access, enforced server-side for API-key calls.
- `--json` returns the API response verbatim.

### procurement

- `purvey procurement list`
- `purvey procurement get <id>`
- `purvey procurement matches <id>`

`procurement matches <id>` options:

- `--page <n>`; 1-based page number
- `--limit <n>`; matches per page, min `1`, max `100`

Examples:

```bash
purvey procurement list --pretty
purvey procurement get <brief-id> --pretty
purvey procurement matches <brief-id> --page 2 --limit 50 --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey procurement list --json
```

Notes:

- Procurement reads are backed by the canonical Parchment API `/v1/procurement/briefs` endpoints through `@purveyors/sdk`.
- Session-token use requires the local `member` role; API-key use is accepted via `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY` and procurement access is enforced server-side.
- Brief creation is intentionally not exposed here. It is a write path and belongs to the Phase 2 write build-out.

### inventory

- `purvey inventory list`
- `purvey inventory get <id>`
- `purvey inventory add`
- `purvey inventory update <id>`
- `purvey inventory delete <id>`

`inventory list` filters:

- `--stocked`
- `--catalog-id <id>`
- `--purchase-date-start <YYYY-MM-DD>`
- `--purchase-date-end <YYYY-MM-DD>`
- `--origin <country>`
- `--limit <n>`; default `20`
- `--offset <n>`; default `0`

`inventory add` flags:

- `--catalog-id <id>`; required in flag mode
- `--qty <lbs>`; required in flag mode
- `--cost <dollars>`
- `--tax-ship <dollars>`
- `--notes <text>`
- `--purchase-date <YYYY-MM-DD>`
- `--form`

`inventory update <id>` flags:

- `--qty <lbs>`
- `--cost <dollars>`
- `--tax-ship <dollars>`
- `--notes <text>`
- `--stocked <true|false>`

`inventory delete <id>` options:

- `--yes`; skip confirmation prompt

Examples:

```bash
purvey inventory list --stocked --pretty
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
purvey inventory add --form
purvey inventory update 7 --stocked false
purvey inventory delete 7 --yes
```

Notes:

- Inventory commands require an owner-bound member API key with the corresponding inventory scope.
- Inventory `id` is `green_coffee_inv.id`, not `catalog_id`.
- `inventory delete` refuses to cascade. Delete dependent roasts or sales explicitly first.

### roast

- `purvey roast list`
- `purvey roast get <id>`
- `purvey roast create`
- `purvey roast update <id>`
- `purvey roast delete <id>`
- `purvey roast import [file]`
- `purvey roast watch [directory]`

`roast list` filters:

- `--coffee-id <id>`; inventory item ID
- `--roast-id <id>`; exact roast profile ID
- `--batch-name <text>`
- `--coffee-name <text>`
- `--date-start <YYYY-MM-DD>`
- `--date-end <YYYY-MM-DD>`
- `--stocked`
- `--catalog-id <id>`
- `--limit <n>`; default `20`
- `--offset <n>`; default `0`

`roast get <id>` options:

- `--include-temps`
- `--include-events`

`roast create` flags:

- `--coffee-id <id>`; required in flag mode
- `--batch-name <name>`
- `--oz-in <oz>`
- `--oz-out <oz>`
- `--roast-date <YYYY-MM-DD>`
- `--notes <text>`
- `--form`

`roast update <id>` flags:

- `--batch-name <name>`
- `--oz-out <oz>`
- `--notes <text>`
- `--targets <text>`

`roast import [file]` flags:

- `--coffee-id <id>`; required unless `--form`
- `--batch-name <name>`
- `--oz-in <oz>`
- `--roast-notes <text>`
- `--roast-targets <text>`
- `--form`

`roast watch [directory]` options:

- `--coffee-id <id>`; required unless `--auto-match`
- `--batch-prefix <name>`
- `--prompt-each`
- `--auto-match`
- `--commit-mode <batch|individual>`
- `--oz-in <oz>`
- `--roast-notes <text>`
- `--roast-targets <text>`
- `--resume`
- `--form`

Examples:

```bash
purvey roast list --catalog-id 128 --pretty
purvey roast get 123 --include-temps --pretty
purvey roast create --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz-in 16
purvey roast import ~/artisan/ethiopia.alog --coffee-id 7 --roast-targets "Aim for 18% development"
purvey roast watch ~/artisan/ --auto-match
```

Notes:

- Roast commands require an authenticated `member` role.
- `--coffee-id` uses inventory IDs.
- `roast import` and `roast watch` normalize pasted paths by trimming whitespace, removing one layer of matching quotes, and accepting common shell-escaped characters.
- `roast watch --auto-match` is mutually exclusive with `--coffee-id`.
- `roast watch --auto-match` uses the `@purveyors/cli/cherry` helper to send roast metadata and the current stocked-inventory candidates to the canonical Parchment `POST /v1/roasts/classify` endpoint via `@purveyors/sdk`; it never calls an AI provider directly.
- `roast watch --commit-mode` defaults to `batch`.

### sales

- `purvey sales list`
- `purvey sales record`
- `purvey sales update <id>`
- `purvey sales delete <id>`

`sales list` filters:

- `--coffee-id <id>`; green coffee inventory ID
- `--date-start <YYYY-MM-DD>`
- `--date-end <YYYY-MM-DD>`
- `--buyer <name>`
- `--limit <n>`; default `20`
- `--offset <n>`; default `0`

`sales record` flags:

- `--roast-id <id>`; resolve the sale inventory and batch from a roast profile
- `--coffee-id <id>`; resolved selector mode, requires `--batch-name`
- `--batch-name <name>`; resolved selector mode, requires `--coffee-id`
- `--oz <amount>`; required in flag mode
- `--price <dollars>`; required in flag mode
- `--buyer <name>`
- `--sell-date <YYYY-MM-DD>`
- `--form`

`sales update <id>` flags:

- `--oz <amount>`
- `--price <dollars>`
- `--buyer <name>`
- `--sell-date <YYYY-MM-DD>`

`sales delete <id>` options:

- `--yes`

Examples:

```bash
purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"
purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 8 --price 16.00
purvey sales list --pretty
purvey sales update 5 --price 24.00
purvey sales delete 5 --yes
```

Notes:

- Sales commands require an authenticated `member` role.
- Use exactly one selector mode for `sales record`: `--roast-id`, or `--coffee-id` plus `--batch-name`.
- Sales retain inventory and batch, not roast ID. Duplicate batch names on one inventory item are rejected even when selected through `--roast-id`.
- `--price` is total sale price, not per-ounce price.

### tasting

- `purvey tasting get <bean-id>`
- `purvey tasting rate [bean-id]`

ID distinction:

- `tasting get <bean-id>` takes a `catalog_id`
- `tasting rate [bean-id]` takes an inventory ID
- The CLI token is `bean-id` for both tasting commands, but the backing ID type is different

`purvey tasting get <bean-id>` options:

- `--filter <user|supplier|both>`; default `both`

`purvey tasting rate [bean-id]` options:

- `--aroma <1-5>`; required in flag mode
- `--body <1-5>`; required in flag mode
- `--acidity <1-5>`; required in flag mode
- `--sweetness <1-5>`; required in flag mode
- `--aftertaste <1-5>`; required in flag mode
- `--brew-method <method>`
- `--notes <text>`
- `--form`

Examples:

```bash
purvey tasting get 128 --filter both --pretty
purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
purvey tasting rate --form
```

Notes:

- Tasting reads accept an owner-bound `tasting:read` API key.
- `tasting get` combines supplier notes with your own notes when available.
- `tasting rate` writes through the canonical Parchment tasting endpoint.

### config

- `purvey config list` (supports `--json`, `--pretty`)
- `purvey config get <key>` (supports `--json`, `--pretty`)
- `purvey config set <key> <value>` (supports `--json`, `--pretty`)
- `purvey config reset` (supports `--json`, `--pretty`)

Current config key:

- `form-mode`: when `true`, write commands enter interactive mode when required args are missing

Examples:

```bash
purvey config set form-mode true
purvey config get form-mode --json
purvey config reset --json
```

Notes:

- Config commands are local-only.
- Config file path: `~/.config/purvey/config.json`
- `--csv` is not supported.

### context

- `purvey context`
- `purvey context --json`
- `purvey context --pretty`

Notes:

- Default output is the dense human-readable operator reference text.
- `--json` and `--pretty` emit the same machine-readable manifest as `purvey manifest`.
- Prefer `purvey manifest` for new machine integrations. Use `purvey context --json` when you need compatibility with an existing `context`-based workflow.
- Use `@purveyors/cli/manifest` when you need that same contract in-process from Node.js or an agent runtime.
- `--csv` is not supported.

### manifest

- `purvey manifest`
- `purvey manifest --json`
- `purvey manifest --pretty`

Notes:

- `purvey manifest` emits the preferred stable machine-readable CLI contract on stdout.
- `purvey manifest` and `purvey manifest --json` both emit compact JSON.
- `purvey manifest --pretty` emits indented JSON.
- `purvey manifest` and `purvey context --json` emit the same JSON payload.
- Use `purvey manifest` for new automation and treat `purvey context --json` as a compatibility alias.
- `--csv` is not supported.

### In-process manifest export

- `@purveyors/cli/manifest`

Use this when you need the same stable contract from Node.js without shelling out to the CLI. This package subpath is exported via `./manifest` in `package.json` and is part of the supported public machine surface for agents and scripts.

```ts
import { getCliManifest } from '@purveyors/cli/manifest';

const manifest = getCliManifest();
```

## Common workflows

### Catalog to inventory to roast to sale

```bash
purvey catalog search --origin "Ethiopia" --process "natural" --stocked --pretty
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
purvey roast import ~/artisan/guji-light.alog --coffee-id 7 --pretty
purvey tasting rate 7 --aroma 5 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 12 --price 22.00 --buyer "Jane Smith"
```

### Continuous Artisan watch mode

```bash
purvey roast watch ~/artisan/ --coffee-id 7
purvey roast watch ~/artisan/ --auto-match
purvey roast watch --resume
```

Watch mode runs until Ctrl+C or SIGTERM. On shutdown it waits for active imports, commits queued batch-mode roasts, prints the verification summary, and leaves session state available for `--resume`.

### Export records for spreadsheets

```bash
purvey inventory list --csv > inventory.csv
purvey roast list --csv > roasts.csv
purvey sales list --csv > sales.csv
```

### Bootstrap an agent or script

```bash
purvey manifest
purvey context
purvey auth login --headless
purvey auth status 2>/dev/null | jq .
```

## ID reference

Use the right ID for the right command.

- `catalog_id`: `coffee_catalog` rows; used by `catalog get`, `catalog similar`, `inventory add --catalog-id`, `tasting get`, `roast list --catalog-id`
- `inventory id`: `green_coffee_inv` rows; used by `inventory get/update/delete`, `roast --coffee-id`, `tasting rate`, `roast list --coffee-id`
- `roast_id`: `roast_data` rows; used by `roast get/delete`, `sales record --roast-id`, `roast list --roast-id`
- `sales record` also supports resolving a roast from `inventory id` plus `--batch-name`; because sales retain inventory + batch rather than roast ID, duplicate batch names on one inventory item are rejected
- `sale id`: `coffee_sales` rows; used by `sales update/delete`

## Environment variables

- `PURVEYORS_BASE_URL`: override the Purveyors web base URL
- `PURVEYORS_API_KEY`: explicit API-key override for canonical Parchment commands
- `PARCHMENT_API_KEY`: preferred API-key variable for SDK-backed Parchment commands; also accepted for API-backed proof and paid-tier similarity paths
- `PARCHMENT_API_BASE_URL`: override the SDK-backed Parchment API base URL, including `market`, `price-index`, `procurement`, and roast auto-classification requests
- `PURVEY_DEBUG`: enable verbose error output

## For AI agents

Recommended bootstrap order:

```bash
purvey manifest
purvey context
purvey auth login --headless
```

Use `purvey manifest` as the authoritative machine-readable entry point. Keep `purvey context` for dense operator context, or use `purvey context --json` only when you need compatibility with an existing wrapper.

Why this CLI works well for agents:

- stable command names
- structured stdout by default
- browser approval with automatic polling and a first-class headless mode
- documented exit codes and role boundaries
- dedicated machine-readable manifest command
- dedicated dense human-readable reference command
- `purvey context --json` parity with `purvey manifest`
- `@purveyors/cli/manifest` export for in-process access
- `--offset` and `--limit` pagination across list commands

The scripting contract is simple: stdout carries successful payloads, stderr carries status and fatal errors, and exit codes stay stable.

Agent integration rules of thumb:

- Discover first with `purvey manifest`, then call the narrowest command or package subpath that fits the job.
- Use `purvey context` when a human-readable operator summary is useful before tool selection.
- Use `purvey auth login` for normal user workflows. Parchment coordinates browser approval and returns a machine-scoped API key; the CLI stores no web session, request token, or PKCE verifier. Environment `PURVEYORS_API_KEY` or `PARCHMENT_API_KEY` values remain available for explicit automation overrides.
- Treat `--include-proof` as API output, not a local scoring feature. Every `catalog search` filter round-trips through the canonical `/v1/catalog` query contract, so proof output always matches the same server-side result set.
- Treat `catalog similar` as the canonical `/v1/catalog/{id}/similar` contract. Preserve the distinction between `canonical_candidates` and `similar_recommendations`; do not flatten or re-sort grouped results unless you have a specific downstream reason.
- Treat `market`, `price-index`, and `procurement` as SDK-backed canonical API reads. Do not add procurement create/write behavior to this command group until the Phase 2 write contract ships.

## Troubleshooting

**`Error: not logged in` or exit code 3**

```bash
purvey auth login
# or
purvey auth login --headless
```

**Catalog commands fail after logging in**

Run `purvey auth status` to confirm the stored CLI key is active and has a `viewer` or `member` role. If it is stale or revoked, run `purvey auth logout` and log in again.

**Wrong ID type passed to a command**

Use the [ID reference](#id-reference) section above. `catalog_id` and inventory IDs are different values.

**Pagination only shows the first page**

All list commands default to 20 results. Use `--limit` and `--offset`.

```bash
purvey inventory list --limit 20 --offset 0
purvey inventory list --limit 20 --offset 20
purvey inventory list --limit 20 --offset 40
```

**`inventory delete` fails with dependency conflict**

```bash
purvey roast delete <roast-id> --yes
purvey sales delete <sale-id> --yes
purvey inventory delete 7 --yes
```

**Enable verbose error output**

```bash
PURVEY_DEBUG=1 purvey <command>
```

## Development

```bash
git clone https://github.com/reedwhetstone/purveyors-cli
cd purveyors-cli
pnpm install
npm run build
npm run verify:contract
npm run verify:dist
npm run verify:prepublish
npm run check
npm run lint
npm test
```

`npm run verify:prepublish` is the release guardrail. It rebuilds first, re-runs the targeted manifest and output-contract suites, checks the compiled `dist/` artifact, verifies the `npm pack --dry-run` publish surface, and smoke-tests `package.json`, `README.md`, `purvey manifest`, `purvey context --json`, and `@purveyors/cli/manifest`.

Key files:

- `src/index.ts`: executable entrypoint
- `src/program.ts`: top-level CLI registration and global options
- `src/commands/`: command definitions and help text
- `src/lib/`: CLI adapters, local workflow behavior, and Parchment SDK integration
- `src/commands/context.ts`: dense human-readable agent reference
- `src/commands/manifest.ts`: machine-readable CLI manifest command
- `src/lib/manifest.ts`: shared manifest contract, package export list, command metadata, ID guidance, and context renderer
- `package.json`: package metadata and export surface, including `./manifest`
- `tests/dist-contract.test.ts`: compiled artifact parity guardrails
- `AGENTS.md`: canonical contributor guide

Live documentation:

- <https://purveyors.io/docs/cli/overview>
- <https://api.purveyors.io/docs>

## License

Sustainable Use License. See [LICENSE.md](./LICENSE.md).

Copyright 2026 Reed Whetstone / purveyors.io
