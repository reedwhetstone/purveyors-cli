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
purvey auth status --pretty
```

Logout:

```bash
purvey auth logout
```

Credentials are stored at `~/.config/purvey/credentials.json`.

### Current auth behavior

Catalog commands are read-only, but the current CLI implementation still expects a valid viewer session. In practice, sign in before using:

- `purvey catalog search`
- `purvey catalog get <id>`
- `purvey catalog stats`
- `purvey catalog similar <id>`

Inventory, roast, sales, and tasting commands require a member role.

## Output and Scripting

Most commands write compact JSON to stdout by default.

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

- `purvey auth status` prints human-readable output in an interactive terminal. When piped or redirected, it emits JSON.
- `purvey catalog similar <id>` currently prints a plain-text ranking by default. Use `--pretty` for structured JSON output.

## Command Overview

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

Key search filters:

- `--origin <text>`
- `--process <method>`
- `--price-min <n>`
- `--price-max <n>`
- `--flavor <keywords>`
- `--name <text>`
- `--supplier <name>`
- `--ids <n,n,...>`
- `--stocked`
- `--sort <price|price-desc|name|origin|newest>`
- `--offset <n>`
- `--limit <n>`

Examples:

```bash
purvey catalog search --origin "Ethiopia" --pretty
purvey catalog search --supplier "Royal Coffee" --stocked --pretty
purvey catalog search --ids "1182,1183,1200"
purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
```

### inventory

- `purvey inventory list`
- `purvey inventory get <id>`
- `purvey inventory add`
- `purvey inventory update <id>`
- `purvey inventory delete <id>`

Create inventory from the catalog:

```bash
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
```

Update fields:

- `--qty <lbs>`
- `--cost <dollars>`
- `--tax-ship <dollars>`
- `--notes <text>`
- `--stocked <true|false>`

### roast

- `purvey roast list`
- `purvey roast get <id>`
- `purvey roast create`
- `purvey roast update <id>`
- `purvey roast delete <id>`
- `purvey roast import [file]`
- `purvey roast watch [directory]`

`roast list` filters:

- `--coffee-id <id>`
- `--batch-name <text>`
- `--date-start <YYYY-MM-DD>`
- `--date-end <YYYY-MM-DD>`
- `--stocked`
- `--catalog-id <id>`
- `--limit <n>`

`roast update <id>` fields:

- `--notes <text>`
- `--oz-out <oz>`
- `--batch-name <name>`
- `--targets <text>`

Examples:

```bash
purvey roast list --catalog-id 128 --pretty
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

Record a sale:

```bash
purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"
```

### tasting

- `purvey tasting get <bean-id>`
- `purvey tasting rate [bean-id]`

`purvey tasting get <bean-id>` options:

- `--filter <user|supplier|both>`

`purvey tasting rate [bean-id]` options:

- `--aroma <1-5>`
- `--body <1-5>`
- `--acidity <1-5>`
- `--sweetness <1-5>`
- `--aftertaste <1-5>`
- `--brew-method <method>`
- `--notes <text>`
- `--form`

Examples:

```bash
purvey tasting get 128 --filter both --pretty
purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
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

- `catalog_id`: catalog rows, used by `catalog get`, `inventory add --catalog-id`, `tasting get`
- `inventory id`: personal inventory rows, used by `inventory get/update/delete`, `roast --coffee-id`, `tasting rate`
- `roast_id`: roast rows, used by `roast get/delete`, `sales --roast-id`
- `sale id`: sales rows, used by `sales update/delete`

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
- a dedicated context command for onboarding

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

Copyright © 2026 Reed Whetstone / purveyors.io
