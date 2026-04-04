# purvey

Coffee intelligence from your terminal.

`purvey` is the official CLI for [purveyors.io](https://purveyors.io). It gives coffee professionals and AI agents direct access to the Purveyors platform from the terminal: catalog search, inventory tracking, roast logging, sales records, tasting notes, and Artisan `.alog` import.

Run `purvey context` for the dense agent reference.

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

## Quick Start

```bash
# 1. Authenticate
purvey auth login

# 2. Confirm the session
purvey auth status

# 3. Search the catalog
purvey catalog search --origin "Ethiopia" --stocked --pretty

# 4. Check inventory
purvey inventory list --stocked --pretty

# 5. Import a roast from Artisan
purvey roast import ~/artisan/my-roast.alog --coffee-id 7 --pretty
```

## Authentication

`purvey` uses Google OAuth through purveyors.io.

Interactive login:

```bash
purvey auth login
```

Headless login for agents, CI, and remote machines:

```bash
purvey auth login --headless
```

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

`catalog` commands require an authenticated viewer session. Sign in before using:

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
- `purvey catalog similar <id>`

`inventory`, `roast`, `sales`, and `tasting` commands require a member role.

## Output and Scripting

Most commands write compact JSON to stdout by default.
Use `--json` if you want to request that mode explicitly.

Pretty JSON:

```bash
purvey inventory list --pretty
```

CSV output for array results:

```bash
purvey inventory list --csv > inventory.csv
purvey sales list --csv > sales.csv
```

Pipe JSON into `jq`:

```bash
purvey inventory list | jq '.[].id'
purvey roast list --limit 5 | jq '.[].roast_id'
purvey auth status 2>/dev/null | jq -r '.email'
```

Operational messages go to stderr, so stdout stays script-friendly.

### Output caveats worth knowing

- `purvey auth status` prints human-readable output in an interactive terminal unless you pass `--json`, `--pretty`, or `--csv`. When piped or redirected, it emits JSON.
- `--json` is an explicit alias for the default compact JSON mode, and it forces JSON even in an interactive terminal.

## Command Reference

### auth

- `purvey auth login`
- `purvey auth login --headless`
- `purvey auth status`
- `purvey auth logout`

### catalog

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
- `purvey catalog similar <id>`

`catalog search` filters:

- `--origin <text>` -- filter by origin (country, continent, or region)
- `--process <method>` -- filter by processing method (e.g. natural, washed)
- `--price-min <n>` -- minimum price per lb (USD)
- `--price-max <n>` -- maximum price per lb (USD)
- `--flavor <keywords>` -- flavor keywords, comma-separated
- `--name <text>` -- filter by coffee name (partial match, case-insensitive)
- `--supplier <name>` -- filter by supplier/source name (partial match, case-insensitive)
- `--ids <n,n,...>` -- fetch specific catalog IDs (comma-separated, ignores limit)
- `--stocked` -- only show currently stocked coffees
- `--variety <text>` -- filter by coffee variety/cultivar (partial match)
- `--drying-method <text>` -- filter by drying method (partial match)
- `--stocked-days <n>` -- only show coffees stocked within N days
- `--sort <price|price-desc|name|origin|newest>` -- sort results
- `--offset <n>` -- skip N results for pagination
- `--limit <n>` -- maximum results to return (default: 10)

`catalog similar <id>` options:

- `--threshold <0-1>` -- minimum similarity score (default: 0.70)
- `--limit <n>` -- max results (default: 10)
- `--stocked-only` -- only show currently stocked beans

Examples:

```bash
purvey catalog search --origin "Ethiopia" --pretty
purvey catalog search --supplier "Royal Coffee" --stocked --pretty
purvey catalog search --ids "1182,1183,1200"
purvey catalog search --stocked --sort price --offset 10 --limit 10
purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
purvey catalog similar 1182 --json | jq '.[0]'
```

### inventory

- `purvey inventory list`
- `purvey inventory get <id>`
- `purvey inventory add`
- `purvey inventory update <id>`
- `purvey inventory delete <id>` (use `--force` to cascade delete dependent roasts and sales)

`inventory list` options:

- `--stocked` -- only show currently stocked beans
- `--catalog-id <id>` -- filter by catalog ID
- `--purchase-date-start <YYYY-MM-DD>` -- only show purchases on or after this date
- `--purchase-date-end <YYYY-MM-DD>` -- only show purchases on or before this date
- `--origin <country>` -- filter by country of origin (partial match)
- `--limit <n>` -- maximum results (default: 20)

`inventory add` flags:

- `--catalog-id <id>` -- [REQUIRED] coffee_catalog.catalog_id
- `--qty <lbs>` -- [REQUIRED] quantity in pounds
- `--cost <dollars>` -- bean cost in dollars
- `--tax-ship <dollars>` -- tax and shipping cost in dollars
- `--notes <text>` -- notes for this inventory item
- `--purchase-date <YYYY-MM-DD>` -- purchase date (defaults to today)
- `--form` -- interactive form mode

`inventory update <id>` flags:

- `--qty <lbs>` -- updated quantity in pounds
- `--cost <dollars>` -- updated bean cost
- `--tax-ship <dollars>` -- updated tax/shipping cost
- `--notes <text>` -- updated notes
- `--stocked <true|false>` -- mark as stocked or not

Examples:

```bash
purvey inventory list --stocked --pretty
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
purvey inventory add --catalog-id 42 --qty 5 --cost 6.25 --tax-ship 4.00
purvey inventory update 7 --stocked false
purvey inventory delete 7 --yes
```

### roast

- `purvey roast list`
- `purvey roast get <id>`
- `purvey roast create`
- `purvey roast update <id>`
- `purvey roast delete <id>`
- `purvey roast import [file]`
- `purvey roast watch [directory]`

`roast list` filters:

- `--coffee-id <id>` -- filter by inventory item ID (green_coffee_inv.id)
- `--roast-id <id>` -- filter by exact roast profile ID
- `--batch-name <text>` -- filter by batch name (partial match, case-insensitive)
- `--coffee-name <text>` -- filter by bean name (partial match, case-insensitive)
- `--date-start <YYYY-MM-DD>` -- only show roasts on or after this date
- `--date-end <YYYY-MM-DD>` -- only show roasts on or before this date
- `--stocked` -- only show roasts for currently stocked beans
- `--catalog-id <id>` -- filter by coffee_catalog ID
- `--limit <n>` -- maximum results (default: 20)

`roast get <id>` options:

- `--include-temps` -- include temperature curve data
- `--include-events` -- include roast event markers

`roast create` flags:

- `--coffee-id <id>` -- [REQUIRED] green_coffee_inv ID
- `--batch-name <name>` -- batch name (defaults to coffee name + today's date)
- `--oz-in <oz>` -- green weight in ounces
- `--oz-out <oz>` -- roasted weight in ounces
- `--roast-date <YYYY-MM-DD>` -- roast date (defaults to today)
- `--notes <text>` -- roast notes
- `--form` -- interactive form mode

`roast update <id>` fields:

- `--notes <text>` -- updated roast notes
- `--oz-out <oz>` -- updated roasted weight (triggers weight loss recalculation)
- `--batch-name <name>` -- updated batch name
- `--targets <text>` -- updated roast targets

`roast import [file]` flags:

- `--coffee-id <id>` -- [REQUIRED] green_coffee_inv ID
- `--batch-name <name>` -- batch name (auto-generated if omitted)
- `--oz-in <oz>` -- green weight (extracted from .alog if present, overridden here)
- `--roast-notes <text>` -- additional roast notes
- `--form` -- interactive form mode

`roast watch [directory]` options:

- `--coffee-id <id>` -- [REQUIRED unless --auto-match] inventory ID for all imports
- `--batch-prefix <name>` -- batch name prefix for auto-named batches
- `--prompt-each` -- prompt for bean selection on each new file
- `--auto-match` -- auto-match beans per file (mutually exclusive with --coffee-id)
- `--resume` -- resume a previous watch session
- `--form` -- interactive setup wizard

Examples:

```bash
purvey roast list --catalog-id 128 --pretty
purvey roast list --batch-name "Ethiopia Guji" --pretty
purvey roast list --date-start 2026-03-01 --date-end 2026-03-31
purvey roast create --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz-in 16
purvey roast update 123 --targets "Aim for FC at 390F, 18% dev"
purvey roast import ~/artisan/ethiopia.alog --coffee-id 7
purvey roast watch ~/artisan/ --auto-match
```

### sales

- `purvey sales list`
- `purvey sales record`
- `purvey sales update <id>`
- `purvey sales delete <id>`

`sales list` filters:

- `--roast-id <id>` -- filter by roast profile ID
- `--date-start <YYYY-MM-DD>` -- only show sales on or after this date
- `--date-end <YYYY-MM-DD>` -- only show sales on or before this date
- `--buyer <name>` -- filter by buyer name (partial match, case-insensitive)
- `--limit <n>` -- maximum results (default: 20)

`sales record` flags:

- `--roast-id <id>` -- [REQUIRED] roast_data.roast_id
- `--oz <amount>` -- [REQUIRED] ounces sold
- `--price <dollars>` -- [REQUIRED] total sale price in dollars
- `--buyer <name>` -- buyer name or identifier
- `--sell-date <YYYY-MM-DD>` -- sale date (defaults to today)
- `--form` -- interactive form mode

`sales update <id>` flags:

- `--oz <amount>` -- updated ounces sold
- `--price <dollars>` -- updated sale price
- `--buyer <name>` -- updated buyer name
- `--sell-date <YYYY-MM-DD>` -- updated sale date

Examples:

```bash
purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"
purvey sales list --pretty
purvey sales update 5 --price 24.00
purvey sales delete 5 --yes
```

### tasting

- `purvey tasting get <bean-id>`
- `purvey tasting rate [bean-id]`

`purvey tasting get <bean-id>` options:

- `--filter <user|supplier|both>` -- which notes to show (default: both)

`purvey tasting rate [bean-id]` options:

- `--aroma <1-5>` -- [REQUIRED in flag mode]
- `--body <1-5>` -- [REQUIRED in flag mode]
- `--acidity <1-5>` -- [REQUIRED in flag mode]
- `--sweetness <1-5>` -- [REQUIRED in flag mode]
- `--aftertaste <1-5>` -- [REQUIRED in flag mode]
- `--brew-method <method>` -- brew method used (e.g. pour_over, espresso)
- `--notes <text>` -- additional tasting notes
- `--form` -- interactive form mode

Examples:

```bash
purvey tasting get 128 --filter both --pretty
purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
purvey tasting rate 42 --aroma 3 --body 3 --acidity 3 --sweetness 3 --aftertaste 3 --notes "Underextracted"
```

### config

- `purvey config list`
- `purvey config get <key>`
- `purvey config set <key> <value>`
- `purvey config reset`

Current config key:

- `form-mode`: when set to `true`, write commands enter interactive mode when required args are missing

Examples:

```bash
purvey config set form-mode true
purvey config get form-mode
```

### context

- `purvey context`

Use this when an agent needs a compact, source-aware CLI reference.

## Common Workflows

### Buy coffee, roast it, rate it, and record a sale

```bash
purvey catalog search --origin "Ethiopia" --process "natural" --stocked --pretty
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
purvey inventory list --stocked --pretty
purvey roast import ~/artisan/guji-light.alog --coffee-id 7 --pretty
purvey tasting rate 7 --aroma 5 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"
```

### Continuous Artisan watch mode

```bash
purvey roast watch ~/artisan/ --coffee-id 7
purvey roast watch ~/artisan/ --auto-match
purvey roast watch --resume
```

### Export records for spreadsheets

```bash
purvey inventory list --csv > inventory.csv
purvey roast list --csv > roasts.csv
purvey sales list --csv > sales.csv
```

## ID Reference

Use the right ID for the right command.

- `catalog_id`: coffee_catalog rows; used by `catalog get`, `inventory add --catalog-id`, `tasting get`, `roast list --catalog-id`
- `inventory id`: green_coffee_inv rows; used by `inventory get/update/delete`, `roast --coffee-id`, `tasting rate`, `roast list --coffee-id`
- `roast_id`: roast_data rows; used by `roast get/delete`, `sales --roast-id`, `roast list --roast-id`
- `sale id`: coffee_sales rows; used by `sales update/delete`

## Environment Variables

- `PURVEYORS_SUPABASE_URL`: override the Supabase project URL
- `PURVEYORS_SUPABASE_ANON_KEY`: override the Supabase anon key
- `PURVEYORS_BASE_URL`: override the Purveyors web base URL
- `PURVEY_DEBUG`: enable verbose error output

## For AI Agents

Start here:

```bash
purvey context
```

Recommended flow:

```bash
purvey auth login --headless
purvey auth status 2>/dev/null | jq .
purvey inventory list | jq '.[].id'
```

The CLI is designed to be agent-friendly:

- stable command names
- structured output on stdout
- headless auth flow
- copy-pasteable examples
- a dedicated `context` command for onboarding

## Development

```bash
git clone https://github.com/reedwhetstone/purveyors-cli
cd purveyors-cli
pnpm install
npm run build
npm run check
npm run lint
npm test
```

Key files:

- `src/index.ts`: top-level CLI registration and global options
- `src/commands/`: command definitions and help text
- `src/lib/`: business logic and Supabase integration
- `src/commands/context.ts`: dense agent reference
- `AGENTS.md`: contributor guide

## License

Sustainable Use License. See [LICENSE.md](./LICENSE.md).

Copyright 2026 Reed Whetstone / purveyors.io
