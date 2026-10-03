# purvey

Coffee intelligence from your terminal.

`purvey` is the official CLI for [purveyors.io](https://purveyors.io). It gives coffee professionals, developers, and AI agents direct access to the Purveyors platform from the terminal: catalog search, Market Index intelligence, price-index snapshots, matched price comparisons, and chart history, procurement brief reads, inventory tracking, roast logging, sales records, tasting notes, and Artisan `.alog` import.

Use `purvey --help` for quick command discovery, `purvey context` for the dense human-readable operator reference, `purvey manifest` for the preferred machine-readable contract, or `@purveyors/cli/manifest` in-process.

## At a glance

- Official binary: `purvey`
- Package: `@purveyors/cli`
- Runtime: Node.js 20+
- No pre-existing credentials required: `auth`, `config`, `context`, `manifest`, `skill`
- Viewer role required: `catalog`, including structured process filters and `catalog similar`
- Member role required: `procurement`, `inventory`, `roast`, `sales`, `tasting`
- Mixed public and entitled access: `market` and `price-index` public teaser slices are unauthenticated; filtered, non-public, and evidence slices require a credential and, where entitled, Parchment Intelligence access
- Preferred machine-readable contract: `purvey manifest`
- Dense human-readable reference: `purvey context`
- Compatibility JSON alias: `purvey context --json`
- In-process machine contract: `@purveyors/cli/manifest`
- Agent instructions generated from the manifest: `purvey skill print`, `purvey skill install`

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

# 3. Search the catalog (any signed-in account)
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
- `purvey skill print` renders an agent skill from the manifest: a compact SKILL.md plus workflows.md with the step-by-step workflows. `purvey skill install` puts it where Claude Code, Codex, or Cursor will load it, or adds a short block to a repository AGENTS.md.

Manifest commands carry `sdkMethods`, the `@purveyors/sdk` operations whose canonical endpoints
they consume, and, for writes, `confirmedActionEquivalents`, the Purveyors web assistant's
confirmed-action types they perform with an API key. An agent that knows an SDK operation can
use these fields to find the matching command. Every read and confirmed action available to the
web assistant has a command, with no exceptions.

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

No pre-existing credentials are required for `auth`, `config`, `context`, `manifest`, or `skill`.

Remote data commands require a valid owner-bound API key with the required scope:

- `catalog` requires the `viewer` role, which any sign-in provides; Parchment decides access to structured process filters and `catalog similar`, and admits any API key with `catalog:read`
- `market` has public teaser slices for `signals --summary`, unfiltered retail `stats`, and process/retail/month `metadata`; all filtered or non-public slices require Parchment Intelligence access enforced server-side
- `market overview` requires any signed-in session or API key; `market evidence` requires Parchment Intelligence access
- `price-index history` is public for windows up to 90 days; longer windows require Parchment Intelligence access
- `price-index` snapshots, `price-index comparisons`, `price-index comparison`, `procurement`, `inventory`, `roast`, `sales`, and `tasting` require the `member` role
- `reference-profile` requires a `member` credential plus Studio access, enforced server-side by Parchment

`purvey` uses Google OAuth through purveyors.io.

Set `PARCHMENT_API_KEY` (or `PURVEYORS_API_KEY`) to authenticate SDK-backed catalog,
inventory, roast, reference-profile, sales, tasting-read, market, price-index, and procurement operations
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

| Role     | Access                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | Every `catalog` command, including structured process filters on `catalog search` and `catalog similar`                                                    |
| `member` | All viewer commands, plus `price-index`, `procurement`, `inventory`, `roast`, `sales`, and `tasting` through the scoped key created by `purvey auth login` |

The `reference-profile` commands also require Studio access; the API enforces this entitlement.

`catalog similar` needs a sign-in (`purvey auth login`) or any API key with `catalog:read`. The free Green API plan includes it within its monthly quota. Parchment decides access and the CLI maps its 401 and 403 responses to exit code 3 with Parchment's message.

Market Index teaser slices are public. Filtered `market signals`, origin/process/wholesale `market stats`, non-public `market metadata`, `market evidence`, `price-index comparisons`, `price-index comparison`, and `price-index history` windows over 90 days require Parchment Intelligence access; API-key denial is enforced by the canonical API. The stored login key carries `catalog:read`, which is also the canonical read scope for Market Index, Price Index, and procurement.

`auth`, `config`, `context`, `manifest`, and `skill` remain available without pre-existing credentials.

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
- `purvey auth whoami`
- `purvey auth logout`

Examples:

```bash
purvey auth login
purvey auth login --headless
purvey auth status --pretty
purvey auth status --csv
purvey auth whoami | jq '.capabilities.profileStudio'
purvey auth logout
```

Notes:

- `auth login` opens a short-lived purveyors.io approval request and completes automatically after approval. If browser launch fails, it prints the same URL and keeps polling.
- `auth login --headless` prints the approval URL without trying to open a local browser. Approve it from any browser; nothing is pasted back.
- `auth status --json` is the safest mode for scripts.
- `auth status --csv` is supported for spreadsheet-style checks, but JSON remains the better integration format.
- `auth whoami` prints Parchment's `GET /v1/me` response unchanged for the credential the CLI would send: roles, API plan, scopes, Price Index access, and capabilities such as `capabilities.profileStudio`. Like the rest of `auth`, it needs no existing credential; without one it prints a signed-out result (`authenticated: false`).

### catalog

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
- `purvey catalog facets [field]`
- `purvey catalog rank`
- `purvey catalog rank-premium`
- `purvey catalog supplier-list`
- `purvey catalog supplier-detail <supplier>`
- `purvey catalog supplier-rank`
- `purvey catalog similar <id>`
- `purvey catalog compare <ids...>`
- `purvey catalog price-history <id>`
- `purvey catalog grades [codes...]`

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
- `--supplier <name>`; partial supplier/source match
- `--drying-method <method>`; drying-method filter, matched by Parchment
- `--flavor <keywords>`; comma-separated flavor keywords, a coffee matches any keyword
- `--stocked`; only currently stocked coffees
- `--sort <price|price-desc|name|origin>`
- `--offset <n>`; pagination offset
- `--limit <n>`; default `10`, min `1`, max `1000`
- `--include-proof`; request canonical proof summaries from `/v1/catalog?include=proof`

Grading filters (results then carry a `grading` object):

- `--elevation-min <masl>`, `--elevation-max <masl>`; disclosed elevation range overlap
- `--screen-min <n>`, `--screen-max <n>`; disclosed screen size, 8 to 20 (an `18+` lot is open-ended)
- `--grade <codes>`; comma-separated grade codes such as `KE:AA,PREP:EP`, matching any
- `--grade-kind <size|altitude|defects|cup|preparation>`; any grade of that kind
- `--peaberry`; peaberry lots only
- `--lab-analyzed`; lots with lab values only
- `--moisture-max <pct>`; disclosed moisture at or below this percentage
- `--score-protocol <sca_2004|cva_affective|q_arabica|coe|supplier_unspecified>`

`catalog compare <ids...>` options:

- 2 to 6 catalog IDs, space- or comma-separated; viewers compare 2, members and API keys up to 6
- `--quantity <lb>`; price each coffee at the tier for this quantity (default 1)

`catalog price-history <id>` options:

- `--days <n>`; `7` to `365`, default `180`

`catalog grades [codes...]` options:

- `--kind <size|altitude|defects|cup|preparation>`, `--system <system>`, `--include-retired`
- Explains codes from `/v1/catalog/grades`; unknown codes are listed under `unknownCodes`

`catalog similar <id>` options:

- `--threshold <score>`; canonical similarity threshold `0.5` to `0.99`, default `0.7`
- `--limit <count>`; default `10`, max `25`
- `--stocked-only`; request only currently stocked coffees
- `--mode <all|likely_same|similar_profile>`; default `all`

`catalog facets [field]` options:

- Fields: `supplier`, `country`, `processing_base_method`, `fermentation_type`, `drying_method`, `wholesale`
- Grading fields: `grade_size`, `grade_altitude`, `grade_defects`, `grade_cup`, `grade_preparation`, `screen_size_min`, `elevation_band`
- Without a field, prints the canonical `/v1/catalog/facets` envelope (`values`, `facets`, `meta`) unchanged; it omits grading facets, so name a grading field to get those counts. With a field, prints `{ field, facet, data, meta }` for that counted facet.
- `--all`; use all visible catalog rows instead of the default stocked-only scope.

`catalog rank` options:

- `--objective <premium|value|fresh_arrival|rare_origin>`; default `premium`
- `--supplier <name>`; optional supplier filter
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
purvey catalog search --supplier "Royal" --flavor "blueberry,jasmine" --stocked --pretty
purvey catalog search --stocked --sort price --offset 10 --limit 10
purvey catalog search --origin "Ethiopia" --include-proof --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey catalog search --origin "Ethiopia" --include-proof --limit 5 --json
purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
purvey catalog similar 1182 --json | jq '.data.groups.canonical_candidates'
purvey catalog facets supplier --pretty
purvey catalog facets --all --json
purvey catalog rank --objective value --country Ethiopia --price-max 12 --json
purvey catalog rank --objective premium --supplier "Royal Coffee" --limit 5 --json
purvey catalog rank-premium --stocked --limit 10 --pretty
purvey catalog supplier-rank --country Ethiopia --non-wholesale-only --min-coffees 3 --json
purvey catalog supplier-detail "Royal Coffee" --pretty
purvey catalog stats --pretty
purvey catalog get 1182 --pretty
purvey catalog get 1182 --include-proof --json
```

Notes:

- Catalog commands require an authenticated `viewer` role. Parchment decides access to structured process filters and admits any API key with `catalog:read`, including the key `purvey auth login` stores.
- Structured process filters use the canonical `/v1/catalog` query contract names while preserving the legacy `--process` label filter.
- `--supplier`, `--drying-method`, and `--flavor` pass through to the canonical `/v1/catalog` `supplier`, `dryingMethod`, and `flavorKeywords` parameters; Parchment applies them, not the CLI.
- `--include-proof` is an opt-in API-backed catalog read. It consumes the canonical proof summary returned by `/v1/catalog?include=proof`; the CLI does not compute proof fields locally or duplicate web/API proof logic.
- If you want proof output against a specific API-key deployment, set `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY`. Otherwise the CLI uses the key created by `purvey auth login`.
- `catalog get` and `catalog similar` both take `coffee_catalog.catalog_id`.
- `catalog rank` and `catalog rank-premium` read `coffee_catalog.purveyor_score` as the canonical quality signal; the CLI does not recompute the upstream Purveyor Score model.
- `catalog facets` and `catalog rank` are generic agent/client intelligence surfaces. Facet values, counts, and metadata come from the canonical API unchanged across the selected stocked/all-visible scope; counts for multi-valued dimensions can overlap, so do not sum them. Ranking responses include sample metadata so callers do not mistake sampled rarity for whole-catalog guarantees.
- Catalog intelligence responses include `meta.sample_limited`, `meta.sample_order`, `meta.truncated`, and rows-examined style metadata where relevant so agents can distinguish ranked samples from full supplier aggregates. Supplier aggregate responses also include `meta.rows_examined`.
- Supplier aggregate commands summarize catalog row counts, stocked counts, Purveyor Score coverage, average score, average confidence, price range, origin/process coverage, and representative top coffees with score qualifiers.
- `catalog similar` uses the beta canonical `/v1/catalog/{id}/similar` API contract, not the legacy direct RPC path.
- `catalog similar --json` works with the `purvey auth login` key or any API key with `catalog:read`, on any API plan, and returns the grouped canonical response object: `data.target`, `data.groups.canonical_candidates`, `data.groups.similar_recommendations`, optional `data.matches`, and `meta`.
- `canonical_candidates` are likely same-lot candidates; `similar_recommendations` are substitutes/profile matches and include blocker reasons when identity gates disagree.
- The command preserves `classification_version`, `query_strategy`, score dimensions, proof summaries, pricing metadata, and classification/blocker details supplied by the API.
- `catalog stats` returns aggregate catalog metrics, not your personal inventory metrics.

### price-index

- `purvey price-index`
- `purvey price-index comparisons`
- `purvey price-index comparison`
- `purvey price-index history`

`price-index` filters:

- `--origin <origin>`
- `--process <method>`
- `--grade <grade>`
- `--from <YYYY-MM-DD>`
- `--to <YYYY-MM-DD>`
- `--wholesale <true|false>`
- `--page <n>`; 1-based page number
- `--limit <n>`; results per page, min `1`, max `100`

`price-index comparisons` options:

- `--wholesale <true|false|all>`

`price-index comparison` options:

- `--origin <origin>`; required
- `--from <YYYY-MM-DD>`; required
- `--to <YYYY-MM-DD>`; required, within 365 days of `--from`
- `--wholesale <true|false>`

`price-index history` options:

- `--window-days <n>`; min `1`, max `365`; windows over 90 days require Parchment Intelligence access
- `--page <n>`; 1-based page number
- `--limit <n>`; results per page, min `1`, max `10000`
- `--order <asc|desc>`

The snapshot filters above belong to the bare `price-index` command; subcommands reject them.

Examples:

```bash
purvey price-index --pretty
purvey price-index --origin "Ethiopia" --from 2026-01-01 --to 2026-06-30 --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey price-index --limit 25 --json
purvey price-index comparisons --pretty
purvey price-index comparison --origin "Ethiopia" --from 2026-08-31 --to 2026-09-30 --json
purvey price-index history --window-days 30 --order desc --json
```

Notes:

- `price-index` is backed by the canonical Parchment API `GET /v1/price-index` through `@purveyors/sdk`.
- Session-token use requires the local `member` role; API-key use is accepted via `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY` and PPI entitlement is enforced server-side.
- `price-index comparisons` (`GET /v1/price-index/comparisons`) lists the origins that have an exact 30-day matched comparison. Each comparison carries its `significance` object verbatim; `classification` is `quiet`, `normal`, `notable`, `exceptional`, or `null`. `null` means fewer than eight baseline windows exist, not that the move is quiet.
- `price-index comparison` (`GET /v1/price-index/comparison`) compares one origin between two exact dates. When fresh coverage is insufficient, `changePercent` is `null`, never zero.
- `price-index history` (`GET /v1/price-index/history`) returns tier-one chart history and runs without credentials for windows up to 90 days.
- `PARCHMENT_API_BASE_URL` overrides the canonical API base for these SDK-backed commands.

### market

- `purvey market signals`
- `purvey market stats`
- `purvey market metadata`
- `purvey market overview`
- `purvey market evidence`

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
purvey market overview --pretty
purvey market evidence --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey market signals --market wholesale --json
```

Notes:

- `market` commands are backed by canonical Parchment API endpoints through `@purveyors/sdk`; the CLI does not compute Market Index intelligence locally.
- Public teaser slices: `signals --summary`, `stats` with no origin/process and `market=retail`, and `metadata` at dimension=process/no-origin/market=retail/grain=month.
- Any filtered or non-public market slice requires Parchment Intelligence access, enforced server-side for API-key calls.
- `market overview` (`GET /v1/market/overview`) returns aggregate-only daily change, coverage, movement, process mix, and origin price distributions. The API rejects anonymous calls; any signed-in session or API key receives the same public evidence.
- `market evidence` (`GET /v1/market/evidence`) returns named arrivals, delistings, comparable lots, and supplier health and price ranges. It requires Parchment Intelligence access.
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

- `--catalog-id <id>`; the catalog lot to add
- `--manual-name <name>`; name for a coffee that is not in the catalog (flag mode needs exactly one of `--catalog-id` or `--manual-name`)
- `--qty <lbs>`; required in flag mode
- `--cost <dollars>`; total amount paid for the beans, not the price per pound
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
- `--rank <n>`; owner-assigned integer rank

`inventory delete <id>` options:

- `--yes`; skip confirmation prompt

Examples:

```bash
purvey inventory list --stocked --pretty
purvey inventory add --catalog-id 128 --qty 10 --cost 85.00
purvey inventory add --manual-name "Farm-gate Ethiopia lot 7" --qty 12 --cost 96
purvey inventory add --form
purvey inventory update 7 --stocked false
purvey inventory update 7 --rank 1
purvey inventory delete 7 --yes
```

Notes:

- Inventory commands require an owner-bound member API key with the corresponding inventory scope.
- Inventory `id` is `green_coffee_inv.id`, not `catalog_id`.
- `inventory delete` refuses to cascade. Delete dependent roasts or sales explicitly first.

### roast

- `purvey roast list`
- `purvey roast get <id>`
- `purvey roast chart <id>`
- `purvey roast create`
- `purvey roast update <id>`
- `purvey roast delete <id>`
- `purvey roast import [file]`
- `purvey roast from-reference <profile-id> <revision-id> --coffee-id <id>`
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

`roast chart <id>` options:

- `--target-points <n>`; approximate samples per series, `50` to `1000` (Parchment defaults to `400`)

`roast chart` prints Parchment's canonical chart-data envelope unchanged: sampled series,
events, and metadata. `data.metadata.revision` is the immutable chart revision that
`reference-profile compare` accepts as `roast:<id>@<revision>`.

`roast create` flags:

- `--coffee-id <id>`; required in flag mode
- `--batch-name <name>`
- `--oz-in <oz>`
- `--oz-out <oz>`
- `--roast-date <YYYY-MM-DD>`
- `--notes <text>`
- `--targets <text>`
- `--roaster-type <text>`
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

`roast from-reference <profile-id> <revision-id>` flags:

- `--coffee-id <id>`; required
- `--batch-name <name>`
- `--roast-date <YYYY-MM-DD>`; defaults to the date in the saved Artisan file
- `--oz-in <oz>`
- `--oz-out <oz>`
- `--roast-notes <text>`
- `--roast-targets <text>`
- `--idempotency-key <key>`

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
purvey roast chart 123 --target-points 120 --json
purvey roast create --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz-in 16
purvey roast import ~/artisan/ethiopia.alog --coffee-id 7 --roast-targets "Aim for 18% development"
purvey roast from-reference 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --coffee-id 7
purvey roast watch ~/artisan/ --auto-match
```

Notes:

- Roast commands require an authenticated `member` role.
- `--coffee-id` uses inventory IDs.
- `roast import` and `roast watch` normalize pasted paths by trimming whitespace, removing one layer of matching quotes, and accepting common shell-escaped characters.
- `roast from-reference` creates a roast from the Artisan file uploaded with `reference-profile import`, so the `.alog` does not need to be on this machine. It also requires Studio access. Only an uploaded Artisan reference qualifies: a generated plan is never recorded as a roast, and a reference saved from a past roast is refused because that roast is already in your history. Output is Parchment's response unchanged: the created roast with its curve, an import summary, and the reference it came from.
- `roast watch --auto-match` is mutually exclusive with `--coffee-id`.
- `roast watch --auto-match` uses the `@purveyors/cli/cherry` helper to send roast metadata and the current stocked-inventory candidates to the canonical Parchment `POST /v1/roasts/classify` endpoint via `@purveyors/sdk`; it never calls an AI provider directly.
- `roast watch --commit-mode` defaults to `batch`: new roasts are queued and saved together when you stop watching, all under the `--batch-prefix` name (the coffee name by default), so the session appears as one batch on the roast page. `--resume` keeps the same batch name.
- `roast watch --commit-mode individual` saves each roast as soon as its file appears, under its own batch name: `<name> #1`, `<name> #2`, and so on.
- Roasts are grouped into a batch by batch name and roast date, so roasts with a different roast date appear as a separate batch even when a resumed session keeps the name. To move an existing roast into a batch, rename it with `purvey roast update <id> --batch-name "<name>"`.

### reference-profile

- `purvey reference-profile list [--include-archived]`
- `purvey reference-profile get <profile-id>`
- `purvey reference-profile chart <profile-id> <revision-id>`
- `purvey reference-profile compare <left> <right> [--unit F|C] [--target-points <n>]`
- `purvey reference-profile import <file>`
- `purvey reference-profile preview <profile-id> <revision-id> --request <file>`
- `purvey reference-profile roasts [--limit <n>]`
- `purvey reference-profile preview-from-roast <roast-id> --request <file> [--roast-revision <token>]`
- `purvey reference-profile from-roast <roast-id> [--artisan-source] [--roast-revision <token>] [--title <text>] [--notes <text>]`
- `purvey reference-profile save <profile-id> <revision-id> --request <file>`
- `purvey reference-profile export <profile-id> <revision-id> --output <file>`

Reference-profile commands use the canonical Parchment API through `@purveyors/sdk`. They
require a member credential and Studio access, which Parchment enforces server-side.

`reference-profile import` uploads an Artisan `.alog` or another file accepted by the
canonical importer. Parchment owns parsing and private source retention. It creates a
reference profile, not an executed roast. `get` returns its current revision; pass
`data.currentRevision.id` to `chart`, `preview`, or `save`.

`preview` and `save` take the same JSON request file. The first supported edits are
explicit bounded bean-temperature or environmental-temperature adjustments over a time
interval in milliseconds. Each request supports at most 12 adjustments; intervals must
be ordered and each nonzero `delta` is bounded from -20 to 20. For example:

```json
{
  "title": "Slightly later development",
  "notes": "Small next-batch adjustment",
  "changes": {
    "temperatureAdjustments": [
      {
        "kind": "bean_temperature",
        "startMilliseconds": 300000,
        "endMilliseconds": 420000,
        "delta": 3
      }
    ]
  }
}
```

The request file may also carry optional provenance for the plan: `userGoal` (up to 600
characters), `modelRecommendation` (up to 800), and `userEdits` (up to 800).

`compare` returns Parchment's charge-aligned measured deltas between two immutable
revisions. Each side is a selector: `revision:<uuid>` (an exact reference revision),
`profile:<uuid>` (that profile's current revision), `roast:<roast-id>` (the roast's current
chart revision), or `roast:<roast-id>@<revision>` (an exact chart revision from `roast chart`).
`--unit` defaults to `F` and `--target-points` defaults to `400` (`50` to `1000`).

```bash
purvey reference-profile compare roast:123 profile:5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty
purvey reference-profile compare roast:123 roast:124 --unit C --json
```

Example flow:

Replace the sample UUIDs below with the profile and revision IDs returned by your commands.

```bash
purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline" --pretty
purvey reference-profile get 5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty
purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty
purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty
purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog
```

#### Plan from a past roast

A roast you imported from an Artisan file can be the base for a plan, with no separate upload.

- `roasts` lists the roasts that qualify, newest first (`--limit` `1` to `50`, default `15`).
  Each entry carries the `roastId` and `roastRevision` the next two commands accept, and the
  reference the roast is or would be saved under. `data.ineligibleRoastCount` counts your other
  roasts, which have no usable Artisan file on record.
- `preview-from-roast` previews the plan with the same request file as `preview`. Nothing is
  saved and the roast is not changed. `data.parentProfileId` and `data.parentRevisionId` name
  the reference the roast is saved under.
- `from-roast --artisan-source` saves the roast's Artisan file as a reference profile. Saving the
  same roast again returns the existing reference. Pass its `data.id` and
  `data.currentRevisionId` to `save`, then `export` the saved plan. Without `--artisan-source`
  the reference is a chart for comparison only and cannot be planned from.
- `--roast-revision` pins the exact roast revision you looked at; when omitted, the roast's
  current revision is used. If the roast changes in between, the command exits 5.

A roast that was entered by hand, logged live, imported before Artisan files were kept, or
whose file is too large cannot be a plan base. The command exits 2 with a message that says
why and what to do next, for example re-importing the roast's `.alog`.

The plan is never a roast you ran: none of these commands create, edit, or duplicate a roast.

```bash
purvey reference-profile roasts --pretty
purvey reference-profile preview-from-roast 4529 --request changes.json --pretty
purvey reference-profile from-roast 4529 --artisan-source --pretty
purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty
purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog
```

Writes generate a new idempotency key per invocation. Pass `--idempotency-key <key>` on
`import`, `from-roast`, or `save` and reuse that key to safely retry the same request. `export` requires a
saved generated revision, writes the unsigned `.alog` plan locally, and emits a JSON
receipt; it refuses to overwrite an existing file unless `--force` is passed. A generated
profile is never executed roast history, and this CLI does not claim verified Artisan 4.2
playback compatibility.

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
- Sales retain inventory and batch, not roast ID. When several roasts share a batch name on one inventory item, such as a `roast watch` batch, the sale is recorded against that batch as a whole, whether you select it with `--roast-id` or with `--coffee-id` plus `--batch-name`.
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

### skill

- `purvey skill print [--file SKILL.md|workflows.md|all]`
- `purvey skill print --agents-md`
- `purvey skill install --target <claude|agents|agents-md> [--scope user|project] [--force] [--dry-run] [--link-claude-md]`

The skill is a folder in the open [Agent Skills](https://agentskills.io/specification) format, rendered from `purvey manifest` so it changes only when the CLI contract changes:

- `SKILL.md` loads whenever the skill triggers. It covers when to use `purvey`, headless sign-in, output and exit codes, the ID map, an index of workflows, and working rules, and points to `purvey manifest` for everything else.
- `workflows.md` holds the step-by-step command sequence for each manifest workflow. `SKILL.md` links to it and tells the agent to read it before a multi-step task, so it is loaded only when needed ([Claude Code](https://code.claude.com/docs/en/skills#add-supporting-files), [Agent Skills](https://agentskills.io/specification#progressive-disclosure)).

`skill print` writes `SKILL.md` to stdout; `--file workflows.md` prints the other file. `--json` or `--pretty` wraps one file as `{ name, file, cliVersion, bytes, content }`, and `--file all --json` prints both as `{ name, cliVersion, files: [{ file, bytes, content }] }`. `--agents-md` prints a shorter block for a repository's AGENTS.md instead.

`skill install` writes the same content to a location an agent loads:

| Target      | User scope (default)                                           | Project scope (`--scope project`)                 | Loaded by                                                       |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `claude`    | `SKILL.md` and `workflows.md` in `~/.claude/skills/purveyors/` | the same files in `.claude/skills/purveyors/`     | Claude Code                                                     |
| `agents`    | `SKILL.md` and `workflows.md` in `~/.agents/skills/purveyors/` | the same files in `.agents/skills/purveyors/`     | Codex, Cursor, and other Agent Skills clients (not Claude Code) |
| `agents-md` | n/a                                                            | one block in `AGENTS.md` in the current directory | Codex and Cursor; Claude Code only as described below           |

Notes:

- No credentials or network access are needed.
- Prints `{ target, scope, path, action, written, dryRun, cliVersion, bytes }` as JSON; `action` is `create`, `update`, `unchanged`, `append`, or `overwrite`.
- `claude` and `agents` also print `files: [{ file, path, action, written, bytes }]`, one entry per file. The top-level `path` is `SKILL.md`, `action` is the most significant file action (`overwrite`, then `update`, `create`, `unchanged`), `written` is true when any file changed, and `bytes` is the total.
- Re-running is safe. Identical files are left alone, an unedited file from an earlier CLI version is updated in place, and a missing `workflows.md` is created, so a `SKILL.md`-only install from an earlier version upgrades cleanly. Rerun after upgrading the CLI.
- Each file is checked on its own. A file with local edits, or one `purvey` did not write, is refused with exit code `6` unless you pass `--force`; the refusal names every such file and writes nothing. `--dry-run` reports the paths and actions without writing.
- `agents-md` adds one marked block to `AGENTS.md` (creating the file if needed) and leaves the rest of the file untouched.
- Claude Code loads skills only from `.claude/skills`, so use `--target claude` for it. It does not read `.agents/`.
- Claude Code reads `AGENTS.md` only as a fallback: when a `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists in the current directory or any directory above it, it reads those instead, unless one imports `@AGENTS.md` ([Claude Code docs](https://code.claude.com/docs/en/memory#agents-md)). `agents-md` reports this as `claudeCode: { visible, via, reason, claudeMdFiles }` in its JSON output and prints a warning on stderr when Claude Code will not see the block. It does not change your `CLAUDE.md` unless you ask.
- `--link-claude-md` (with `agents-md`) adds that import: one `@AGENTS.md` line appended to `./CLAUDE.md` (or `@../AGENTS.md` to `./.claude/CLAUDE.md`), creating `./CLAUDE.md` if neither exists. It is a no-op when Claude Code already sees the block, honors `--dry-run`, and never edits `CLAUDE.local.md` or a parent directory's `CLAUDE.md`. `claudeCode.link` reports `{ path, action, written }`, where `action` is `create`, `append`, `unchanged`, or `not-needed`.

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
purvey inventory add --catalog-id 128 --qty 10 --cost 85.00
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

### Plan an Artisan reference

Replace the sample UUIDs with IDs returned by your own import and save commands.

```bash
purvey reference-profile import ~/artisan/ethiopia.alog --title "Ethiopia baseline"
purvey reference-profile get 5ea1af6f-234c-43a9-9bf8-5678dd24f854 --pretty
purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty
purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json
purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog
```

Review the preview before saving. The export is an unsigned plan; Artisan 4.2 playback
compatibility has not yet been established.

### Plan the next roast from a past roast

Replace the sample roast ID and UUIDs with the values returned by your own commands.

```bash
purvey reference-profile roasts --pretty
purvey reference-profile preview-from-roast 4529 --request changes.json --pretty
purvey reference-profile from-roast 4529 --artisan-source --pretty
purvey reference-profile save 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json
purvey reference-profile export 0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90 c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68 --output ~/artisan/next-batch.alog
```

Only roasts imported from an Artisan file that is still on record are listed. The saved plan
is a reference profile, not a roast in your history.

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
- `roast_id`: `roast_data` rows; used by `roast get/delete`, `sales record --roast-id`, `roast list --roast-id`, `reference-profile preview-from-roast/from-roast`
- `sales record` also supports resolving a roast from `inventory id` plus `--batch-name`; because sales retain inventory + batch rather than roast ID, roasts that share a batch name on one inventory item are sold as one batch
- `sale id`: `coffee_sales` rows; used by `sales update/delete`
- `reference_profile_id`: owner-scoped Studio profile UUID; used by `reference-profile get/chart/preview/save/export` and `roast from-reference`
- `reference_revision_id`: immutable revision UUID; used by `reference-profile chart/preview/save/export` and `roast from-reference`

## Environment variables

- `PURVEYORS_BASE_URL`: override the Purveyors web base URL
- `PURVEYORS_API_KEY`: explicit API-key override for canonical Parchment commands
- `PARCHMENT_API_KEY`: preferred API-key variable for SDK-backed Parchment commands; also accepted for API-backed proof and API-key similarity requests
- `PARCHMENT_API_BASE_URL`: override the SDK-backed Parchment API base URL, including `market`, `price-index`, `procurement`, `reference-profile`, and roast auto-classification requests
- `PURVEY_DEBUG`: enable verbose error output

## For AI agents

Recommended bootstrap order:

```bash
purvey skill install --target claude   # Claude Code; Codex and Cursor: --target agents
purvey auth login --headless
purvey manifest
```

The installed skill gives a coding agent the sign-in flow, output contract, and ID map up front, the step-by-step workflows in `workflows.md` when a task needs them, and `purvey manifest` for the full contract.

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

Only `catalog search` (default 10 results), `inventory list`, `roast list`, and `sales list` (default 20) page with `--limit` and `--offset`.

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
