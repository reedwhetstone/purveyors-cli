# purvey

Coffee intelligence from your terminal.

`purvey` is the official CLI for [purveyors.io](https://purveyors.io). It gives coffee professionals, developers, and AI agents direct access to the Purveyors platform from the terminal: catalog search, inventory tracking, roast logging, sales records, tasting notes, and Artisan `.alog` import.

Use `purvey --help` for quick command discovery, `purvey context` for the dense human-readable operator reference, `purvey manifest` for the preferred machine-readable contract, or `@purveyors/cli/manifest` in-process.

## At a glance

- Official binary: `purvey`
- Package: `@purveyors/cli`
- Runtime: Node.js 20+
- No pre-existing session required: `auth`, `config`, `context`, `manifest`
- Viewer role required: `catalog` (excluding structured process filters on `catalog search`)
- Member role required: `inventory`, `roast`, `sales`, `tasting`
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
| <https://purveyors.io/docs/api/overview>         | Live API docs                                             |
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
4. `https://purveyors.io/docs/cli/overview` and `https://purveyors.io/docs/api/overview` are the primary live product docs for external readers.

The CLI is an agent-first product surface. Treat the binary, exported functions, `purvey manifest`, `purvey context`, stdout/stderr behavior, and role-gated command boundaries as one contract.

## Quick Start

```bash
# 1. Authenticate before using catalog, inventory, roast, sales, or tasting commands
purvey auth login

# For agents, CI, or remote machines, use headless flow:
# purvey auth login --headless

# If automatic browser callback handling fails or you paste a bad URL, paste the full callback URL back into the terminal. The CLI keeps waiting until a valid callback is received.

# 2. Confirm the session and role
purvey auth status

# 3. Search the catalog (viewer role for basic filters, member role for structured process filters)
purvey catalog search --origin "Ethiopia" --stocked --pretty

# Example with structured process filters and proof output
purvey catalog search --origin "Ethiopia" --processing-base-method "Washed" --include-proof --pretty

# 4. Check inventory (requires member role)
purvey inventory list --stocked --pretty

# 5. Import a roast from Artisan
purvey roast import ~/artisan/my-roast.alog --coffee-id 7 --pretty

# 6. Get the machine-readable CLI contract
purvey manifest

# 7. Get the dense readable CLI reference
purvey context
```

## Reference surfaces

Use the right reference surface for the job:

- `purvey manifest` is the preferred stable machine-readable contract for agents, scripts, generated tooling, and parity checks.
- `purvey context` is the dense human-readable operator reference for reviewers and interactive use.
- `purvey context --json` and `purvey context --pretty` emit the same JSON payload as `purvey manifest`, but exist mainly for compatibility with tooling that already shells out to `context`.
- `@purveyors/cli/manifest` exposes the same contract in-process for Node.js and agent runtimes.

## Package exports and shared product surface

The npm package is both a binary and a shared TypeScript product surface. `coffee-app` and agent runtimes import CLI business functions directly, so exported subpaths are part of the supported machine contract.

| Import path                | Use it for                                     |
| -------------------------- | ---------------------------------------------- |
| `@purveyors/cli`           | CLI entrypoint package root                    |
| `@purveyors/cli/catalog`   | Catalog search, lookup, stats, similar coffees |
| `@purveyors/cli/inventory` | Green coffee inventory operations              |
| `@purveyors/cli/roast`     | Roast profile operations                       |
| `@purveyors/cli/sales`     | Sales record operations                        |
| `@purveyors/cli/tasting`   | Tasting note and rating operations             |
| `@purveyors/cli/lib`       | Shared library helpers                         |
| `@purveyors/cli/manifest`  | Stable machine-readable CLI manifest           |
| `@purveyors/cli/artisan`   | Artisan `.alog` parsing and import utilities   |
| `@purveyors/cli/ai`        | AI helper surface used by CLI workflows        |

Shell integrations should usually start with `purvey manifest`. In-process agent and website integrations should import the smallest relevant subpath instead of shelling out when they are already running in Node.js.

Export discipline:

- Add or remove subpaths only when the package contract intentionally changes.
- Keep `package.json`, `README.md`, `AGENTS.md`, `docs/CLI_STRATEGY.md`, `src/lib/manifest.ts`, and dist parity checks aligned in the same PR.
- Prefer the narrowest import path for application and agent code. For example, use `@purveyors/cli/catalog` for catalog operations instead of importing the package root.
- Treat export-shape changes as product changes because coffee-app and agent runtimes import these functions directly.

## Authentication and access model

No pre-existing session is required for `auth`, `config`, `context`, or `manifest`.

All remote data commands require a valid authenticated session:

- `catalog` requires the `viewer` role by default
- `catalog search` structured process filters require the `member` role under the current session-authenticated CLI path
- `inventory`, `roast`, `sales`, and `tasting` require the `member` role

`purvey` uses Google OAuth through purveyors.io.

Interactive login:

```bash
purvey auth login
```

Headless login for agents, CI, and remote machines:

```bash
purvey auth login --headless
# CLI prints a Google OAuth URL
# Open it in any browser and sign in
# Paste the full callback URL back into the terminal
```

If the browser cannot return to the CLI during interactive login, paste the full callback URL back into the terminal. Invalid pasted URLs are ignored, and the CLI keeps waiting until a valid callback is received. Use `purvey auth login --headless` when you need the CLI to print the OAuth URL for another browser.

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

| Role     | Access                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | `catalog search`, `catalog get`, `catalog stats`, `catalog similar`, excluding structured process filters                                                   |
| `member` | All viewer commands, structured process filters on `catalog search`, plus `inventory`, `roast`, `sales`, `tasting` under the session-authenticated CLI path |

`auth`, `config`, `context`, and `manifest` remain available without a pre-existing session.

Commands that require a higher role exit with code `3` on auth failure. That includes not being signed in, an expired session, or an insufficient role.

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

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Success                                                          |
| `1`  | Unexpected or unclassified error                                 |
| `2`  | Invalid argument or bad input                                    |
| `3`  | Auth error: not logged in, expired session, or insufficient role |
| `4`  | Not found                                                        |
| `5`  | Dependency conflict                                              |
| `6`  | Local config error                                               |

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

- `auth login` uses browser-based Google OAuth, listens for the localhost callback, and also accepts a pasted callback URL if the browser cannot return to the CLI. Invalid pasted callback URLs are ignored so you can paste again while the CLI keeps waiting.
- `auth login --headless` prints an OAuth URL and accepts a pasted callback URL.
- `auth status --json` is the safest mode for scripts.
- `auth status --csv` is supported for spreadsheet-style checks, but JSON remains the better integration format.

### catalog

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
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
- `--flavor <keywords>`; comma-separated flavor terms
- `--name <text>`; partial coffee name match
- `--supplier <name>`; partial supplier match
- `--ids <n,n,...>`; fetch specific catalog IDs, ignores limit and offset
- `--variety <text>`; partial cultivar match
- `--drying-method <text>`; partial drying method match
- `--stocked-days <n>`; stocked within N days
- `--stocked`; only currently stocked coffees
- `--sort <price|price-desc|name|origin|newest>`
- `--offset <n>`; pagination offset
- `--limit <n>`; default `10`
- `--include-proof`; request canonical proof summaries from `/v1/catalog?include=proof`

`catalog similar <id>` options:

- `--threshold <0-1>`; default `0.70`
- `--limit <n>`; default `10`
- `--stocked-only`

Examples:

```bash
purvey catalog search --origin "Ethiopia" --pretty
purvey catalog search --processing-base-method "Natural" --fermentation-type "Anaerobic" --pretty
purvey catalog search --process-additive "hops" --processing-confidence-min 0.8 --pretty
purvey catalog search --supplier "Royal Coffee" --stocked --pretty
purvey catalog search --ids "1182,1183,1200"
purvey catalog search --stocked --sort price --offset 10 --limit 10
purvey catalog search --origin "Ethiopia" --include-proof --json
PARCHMENT_API_KEY="$PURVEYORS_API_KEY" purvey catalog search --origin "Ethiopia" --include-proof --limit 5 --json
purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
purvey catalog stats --pretty
purvey catalog get 1182 --pretty
purvey catalog get 1182 --include-proof --json
```

Notes:

- Catalog commands require an authenticated `viewer` role by default.
- Structured process filters on `catalog search` require an authenticated `member` role under the current session-authenticated CLI path.
- Structured process filters use the canonical `/v1/catalog` query contract names while preserving the legacy `--process` label filter.
- `--include-proof` is an opt-in API-backed catalog read. It consumes the canonical proof summary returned by `/v1/catalog?include=proof`; the CLI does not compute proof fields locally or duplicate web/API proof logic.
- `--include-proof` rejects CLI-only filters that `/v1/catalog` cannot yet preserve exactly, such as `--flavor`, `--supplier`, `--drying-method`, and `--sort newest`.
- If you want proof output against an API-key deployment, set `PARCHMENT_API_KEY` or `PURVEYORS_API_KEY` before running the command. Otherwise the CLI uses your logged-in Purveyors session token.
- `catalog get` and `catalog similar` both take `coffee_catalog.catalog_id`.
- `catalog similar` uses the API/server similarity contract when available and returns matches sorted by similarity score.
- `catalog stats` returns aggregate catalog metrics, not your personal inventory metrics.

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

- `--force`; cascade dependent roasts and sales
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

- Inventory commands require an authenticated `member` role.
- Inventory `id` is `green_coffee_inv.id`, not `catalog_id`.
- `inventory delete` may require `--force` if dependent roasts or sales exist.

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
- `roast watch --commit-mode` defaults to `batch`.

### sales

- `purvey sales list`
- `purvey sales record`
- `purvey sales update <id>`
- `purvey sales delete <id>`

`sales list` filters:

- `--roast-id <id>`
- `--date-start <YYYY-MM-DD>`
- `--date-end <YYYY-MM-DD>`
- `--buyer <name>`
- `--limit <n>`; default `20`
- `--offset <n>`; default `0`

`sales record` flags:

- `--roast-id <id>`; exact selector mode
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
- Use exactly one selector mode for `sales record`: exact `--roast-id`, or resolved `--coffee-id` plus `--batch-name`.
- If resolved mode matches multiple roasts, rerun with `--roast-id`.
- `--price` is total sale price, not per-ounce price.

### tasting

- `purvey tasting get <catalog-id>`
- `purvey tasting rate [inventory-id]`

ID distinction:

- `tasting get` takes a `catalog_id`
- `tasting rate` takes an `inventory id`

`purvey tasting get <catalog-id>` options:

- `--filter <user|supplier|both>`; default `both`

`purvey tasting rate [inventory-id]` options:

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

- Tasting commands require an authenticated `member` role.
- `tasting get` combines supplier notes with your own notes when available.
- `tasting rate` writes scores back to your inventory row.

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

- `catalog_id`: `coffee_catalog` rows; used by `catalog get`, `inventory add --catalog-id`, `tasting get`, `roast list --catalog-id`
- `inventory id`: `green_coffee_inv` rows; used by `inventory get/update/delete`, `roast --coffee-id`, `tasting rate`, `roast list --coffee-id`
- `roast_id`: `roast_data` rows; used by `roast get/delete`, `sales --roast-id`, `roast list --roast-id`
- `sales record` also supports resolving a roast from `inventory id` plus `--batch-name`; if that selector is ambiguous, use exact `roast_id`
- `sale id`: `coffee_sales` rows; used by `sales update/delete`

## Environment variables

- `PURVEYORS_SUPABASE_URL`: override the Supabase project URL
- `PURVEYORS_SUPABASE_ANON_KEY`: override the Supabase anon key
- `PURVEYORS_BASE_URL`: override the Purveyors web base URL
- `PURVEYORS_API_KEY`: API-key token used by API-backed catalog proof reads when you want to call the canonical API contract without relying on the local OAuth session
- `PARCHMENT_API_KEY`: alternate API-key variable accepted for the same API-backed proof path
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
- browser auth with pasted-callback fallback and headless auth
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
- Prefer OAuth session tokens for normal user workflows; use `PURVEYORS_API_KEY` or `PARCHMENT_API_KEY` only when you intentionally need the API-key catalog proof path.
- Treat `--include-proof` as API output, not a local scoring feature. If a filter cannot round-trip through `/v1/catalog?include=proof`, the CLI rejects that invocation instead of returning misleading proof data.
- Treat `catalog similar` results as server-ranked similarity matches. Do not re-sort them client-side unless you have a specific downstream reason.

## Troubleshooting

**`Error: not logged in` or exit code 3**

```bash
purvey auth login
# or
purvey auth login --headless
```

**Catalog commands fail after logging in**

Run `purvey auth status` to confirm you have a `viewer` or `member` role. If the session is stale, run `purvey auth logout` and log in again.

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
purvey inventory delete 7 --force --yes
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
- `src/lib/`: business logic and Supabase integration
- `src/commands/context.ts`: dense human-readable agent reference
- `src/commands/manifest.ts`: machine-readable CLI manifest command
- `src/lib/manifest.ts`: shared manifest contract, package export list, command metadata, ID guidance, and context renderer
- `package.json`: package metadata and export surface, including `./manifest`
- `tests/dist-contract.test.ts`: compiled artifact parity guardrails
- `AGENTS.md`: canonical contributor guide

Live documentation:

- <https://purveyors.io/docs/cli/overview>
- <https://purveyors.io/docs/api/overview>

## License

Sustainable Use License. See [LICENSE.md](./LICENSE.md).

Copyright 2026 Reed Whetstone / purveyors.io
