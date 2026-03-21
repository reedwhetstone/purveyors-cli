# purvey — The Purveyors CLI

> Coffee intelligence from your terminal.

`purvey` is the official command-line interface for [purveyors.io](https://purveyors.io). It gives coffee professionals direct terminal access to the Purveyors platform: search green coffee availability, track pricing tiers, monitor inventory, record roasts, log sales, and capture tasting notes — all from your terminal or scripts.

**Designed for both humans and AI agents.** Run `purvey context` for instant agent onboarding.

---

## Installation

```bash
npm install -g @purveyors/cli
```

Requires **Node.js >= 20**.

Verify:

```bash
purvey --version
```

---

## Quick Start

```bash
# 1. Authenticate
purvey auth login

# 2. Confirm your session
purvey auth status

# 3. Search the catalog (no login required)
purvey catalog search --origin "Ethiopia" --stocked --pretty

# 4. Check your inventory
purvey inventory list --stocked --pretty

# 5. Import a roast from Artisan
purvey roast import ~/artisan/my-roast.alog --coffee-id 7 --pretty
```

---

## Authentication

`purvey` authenticates via Google OAuth, using the same account as your purveyors.io web session.

### Browser Login (interactive)

```bash
purvey auth login
```

Opens your default browser. Complete Google sign-in, then return to the terminal. Credentials are stored at `~/.config/purvey/credentials.json` (owner-readable only, mode 0600).

### Headless Login (agents, CI, servers)

```bash
purvey auth login --headless
```

No browser required. The CLI prints a Google OAuth URL — open it in any browser, sign in, then copy the full callback URL and paste it back at the prompt.

### Status

```bash
purvey auth status
purvey auth status --pretty
```

```
✔ Logged in as you@example.com
ℹ Role: member
ℹ Token expires: 2026-04-01T08:00:00.000Z
```

### Token Refresh

Tokens refresh automatically. No need to re-login between sessions.

### Logout

```bash
purvey auth logout
```

Clears stored credentials from disk.

---

## Output Formats

All `purvey` commands default to **compact JSON** — one line, no colors, machine-readable. This makes `purvey` pipeable into `jq`, `csvkit`, or any script.

### Compact JSON (default)

```bash
purvey auth status
# → {"authenticated":true,"email":"you@example.com","role":"member","tokenExpires":"..."}
```

### Pretty JSON (`--pretty`)

```bash
purvey catalog search --origin "Ethiopia" --pretty
# → indented, colorized JSON
```

### CSV (`--csv`)

```bash
purvey inventory list --csv > inventory.csv
purvey catalog search --stocked --csv | head -5
```

### Piping with jq

```bash
purvey inventory list | jq '.[].id'
purvey catalog search --origin "Colombia" | jq '.[].cost_lb'
purvey auth status | jq -r '.email'
```

User feedback messages (spinners, success/error) go to **stderr** only — stdout is always clean data, safe to pipe.

---

## Command Reference

### Authentication

| Command                        | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `purvey auth login`            | Log in via Google OAuth (browser)             |
| `purvey auth login --headless` | Log in without a browser (paste callback URL) |
| `purvey auth status`           | Show current authentication state and role    |
| `purvey auth logout`           | Clear stored credentials                      |

### Catalog (no authentication required)

| Command                   | Description                                         |
| ------------------------- | --------------------------------------------------- |
| `purvey catalog search`   | Search coffees by origin, process, price, or flavor |
| `purvey catalog get <id>` | Get details for a specific coffee by catalog ID     |
| `purvey catalog stats`    | Aggregate statistics for the full catalog           |

**catalog search options:**

```
--origin <text>      country or region (e.g. "Ethiopia", "Colombia")
--process <method>   natural, washed, honey
--price-min <n>      min USD/lb
--price-max <n>      max USD/lb
--flavor <keywords>  comma-separated (e.g. "blueberry,citrus")
--stocked            only currently stocked coffees
--limit <n>          max results (default: 10)
```

### Inventory (member role required)

| Command                        | Description                      |
| ------------------------------ | -------------------------------- |
| `purvey inventory list`        | List your green coffee inventory |
| `purvey inventory get <id>`    | Get a single inventory item      |
| `purvey inventory add`         | Add a bean to your inventory     |
| `purvey inventory update <id>` | Update an inventory item         |
| `purvey inventory delete <id>` | Delete an inventory item         |

**inventory add** — required flags: `--catalog-id`, `--qty`

```bash
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
purvey inventory add --form    # interactive wizard
```

### Roast Profiles (member role required)

| Command                      | Description                           |
| ---------------------------- | ------------------------------------- |
| `purvey roast list`          | List your roast profiles              |
| `purvey roast get <id>`      | Get a single roast profile            |
| `purvey roast create`        | Create a new roast profile            |
| `purvey roast update <id>`   | Update a roast profile                |
| `purvey roast delete <id>`   | Delete a roast profile                |
| `purvey roast import [file]` | Import an Artisan .alog roast file    |
| `purvey roast watch [dir]`   | Watch a directory for new .alog files |

**roast import** — required: `<file>`, `--coffee-id`

```bash
purvey roast import ~/artisan/ethiopia.alog --coffee-id 7
purvey roast import --form    # interactive wizard
```

**roast watch** — required: `<directory>`, `--coffee-id` (or `--auto-match`)

```bash
purvey roast watch ~/artisan/ --coffee-id 7
purvey roast watch ~/artisan/ --auto-match    # AI matches beans per file
purvey roast watch --resume                  # continue previous session
```

### Sales (member role required)

| Command                    | Description             |
| -------------------------- | ----------------------- |
| `purvey sales list`        | List your sales records |
| `purvey sales record`      | Record a new sale       |
| `purvey sales update <id>` | Update a sale record    |
| `purvey sales delete <id>` | Delete a sale record    |

**sales record** — required flags: `--roast-id`, `--oz`, `--price`

```bash
purvey sales record --roast-id 123 --oz 12 --price 22.00
purvey sales record --form    # interactive wizard
```

### Tasting Notes (member role required)

| Command                              | Description                            |
| ------------------------------------ | -------------------------------------- |
| `purvey tasting get <catalog-id>`    | Get tasting notes for a catalog coffee |
| `purvey tasting rate [inventory-id]` | Rate a coffee with cupping scores      |

**tasting rate** — required (flag mode): `<inventory-id>` + all five score flags

```bash
purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
purvey tasting rate --form    # interactive wizard
```

### Configuration

| Command                           | Description                  |
| --------------------------------- | ---------------------------- |
| `purvey config list`              | Show all config values       |
| `purvey config get <key>`         | Get a single config value    |
| `purvey config set <key> <value>` | Set a config value           |
| `purvey config reset`             | Reset all config to defaults |

**Supported config keys:**

| Key         | Values           | Description                                                                          |
| ----------- | ---------------- | ------------------------------------------------------------------------------------ |
| `form-mode` | `true` / `false` | When true, write commands auto-enter interactive wizard if required args are missing |

```bash
purvey config set form-mode true
purvey config get form-mode
purvey config list
```

---

## Common Workflows

### Buy green coffee, roast it, record a sale

```bash
# Find a coffee
purvey catalog search --origin "Ethiopia" --process "natural" --stocked --pretty

# Add to inventory (catalog-id from search results)
purvey inventory add --catalog-id 128 --qty 10 --cost 8.50

# Get your inventory id
purvey inventory list --stocked --pretty

# Import a roast from Artisan (inventory id = 7)
purvey roast import ~/artisan/guji-light.alog --coffee-id 7 --pretty

# Rate the coffee after brewing
purvey tasting rate 7 --aroma 5 --body 3 --acidity 5 --sweetness 4 --aftertaste 4

# Record a sale (roast_id from import output)
purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"
```

### Continuous watch mode for Artisan

```bash
# Watch a directory — auto-imports every new .alog file
purvey roast watch ~/Library/Application\ Support/Artisan-Scope/artisan/ --coffee-id 7

# Resume a watch session after restart
purvey roast watch --resume
```

### Export data for spreadsheets

```bash
purvey inventory list --csv > inventory.csv
purvey roast list --csv > roasts.csv
purvey sales list --csv > sales.csv
```

---

## Environment Variables

| Variable                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `PURVEYORS_SUPABASE_URL`      | Override the Supabase project URL (dev/staging) |
| `PURVEYORS_SUPABASE_ANON_KEY` | Override the Supabase anon key                  |
| `PURVEY_DEBUG`                | Set to any value to enable verbose error output |

---

## For AI Agents

`purvey` is built with AI agents in mind. Every command has structured JSON output, clear error messages, and an `--headless` auth flow.

### Agent Onboarding

Run this once to get complete CLI knowledge:

```bash
purvey context
```

This outputs a comprehensive, token-efficient reference covering all commands, required vs optional flags, data model relationships, common workflows, and error recovery. Designed for agents to read once and use every command correctly.

### Agent Auth Flow

```bash
purvey auth login --headless
# → prints OAuth URL
# → user opens URL, signs in, pastes callback URL back
# Token auto-refreshes; no further auth action needed.
```

### Agent Usage Pattern

```bash
# Check auth before any write operations
purvey auth status

# Always use JSON output (default) for scripting
purvey catalog search --origin "Ethiopia" | jq '.[0].catalog_id'
purvey inventory list | jq '.[] | select(.stocked == true) | .id'

# Use --yes to skip confirmation prompts in automated flows
purvey inventory delete 7 --yes
purvey sales delete 5 --yes
```

### ID Types (avoid confusion)

| ID             | Table              | Used with                                                          |
| -------------- | ------------------ | ------------------------------------------------------------------ |
| `catalog_id`   | `coffee_catalog`   | `catalog get`, `inventory add --catalog-id`, `tasting get`         |
| `inventory_id` | `green_coffee_inv` | `inventory get/update/delete`, `roast --coffee-id`, `tasting rate` |
| `roast_id`     | `roast_data`       | `roast get/delete`, `sales --roast-id`                             |
| `sale_id`      | `coffee_sales`     | `sales update/delete`                                              |

---

## Development

```bash
git clone https://github.com/reedwhetstone/purveyors-cli
cd purveyors-cli
pnpm install
```

Create a `.env` file:

```
PURVEYORS_SUPABASE_URL=https://your-project.supabase.co
PURVEYORS_SUPABASE_ANON_KEY=your-anon-key
```

Run locally:

```bash
pnpm dev -- auth status
pnpm dev -- catalog search --origin Ethiopia --pretty
pnpm dev -- --help
```

Build:

```bash
pnpm build
```

Lint + type check + test:

```bash
pnpm lint
pnpm check
pnpm test
```

### Architecture

```
src/
  index.ts           Entry point — registers all subcommands
  commands/          One file per command group
    auth.ts          OAuth login/status/logout
    catalog.ts       Public coffee catalog search
    config.ts        CLI configuration
    context.ts       Agent onboarding reference
    inventory.ts     Green coffee inventory management
    roast.ts         Roast profiles + Artisan .alog import
    sales.ts         Sales recording
    tasting.ts       Cupping notes and scoring
  lib/               Business logic (no Commander dependencies)
    supabase.ts      Auth client + session management
    catalog.ts       Catalog query functions
    inventory.ts     Inventory CRUD
    roast.ts         Roast profile CRUD + import pipeline
    sales.ts         Sales CRUD
    tasting.ts       Tasting notes + cupping score logic
    artisan/         Artisan .alog parser
    interactive/     Interactive form prompts + watch mode
    output.ts        JSON/CSV output formatting
    errors.ts        Error handling + withErrorHandling wrapper
    config.ts        Local config read/write
```

See [AGENTS.md](./AGENTS.md) for the full contributor guide including code conventions and PR requirements.

---

## License

Sustainable Use License. See [LICENSE.md](./LICENSE.md).

Copyright © 2026 Reed Whetstone / purveyors.io
