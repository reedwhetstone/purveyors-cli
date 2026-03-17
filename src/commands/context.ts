import { Command } from 'commander';

// ─── Agent Context Reference ──────────────────────────────────────────────────
//
// This text is optimized for token efficiency: dense, structured, no fluff.
// An agent reading this once should be able to use every CLI command correctly.

const CONTEXT_TEXT = `
PURVEY CLI — Agent Reference v0.5
==================================
CLI for purveyors.io coffee marketplace. Node >=20 required.
Credentials: ~/.config/purvey/credentials.json (auto-refreshed, do not edit)

ROLES
-----
viewer  — catalog commands only (no login required for catalog search/get/stats)
member  — all commands; required for inventory, roast, sales, tasting

AUTHENTICATION
--------------
Browser login (interactive):
  purvey auth login

Headless login (agents/CI — no browser):
  purvey auth login --headless
  → prints Google OAuth URL
  → user opens URL, signs in, copies callback URL
  → paste callback URL back at prompt
  Token auto-refreshes; no action needed between sessions.

Check status:
  purvey auth status --pretty
  purvey auth status           # compact JSON: {"authenticated":true,"email":"...","role":"..."}

Logout:
  purvey auth logout

OUTPUT FORMATS
--------------
Default: compact single-line JSON (machine-readable, pipeable to jq)
--pretty: indented + colorized JSON (human-readable)
--csv:    CSV rows (pipeable to spreadsheets)
User feedback (spinners, success/error) → stderr only; stdout is always clean data.

DATA MODEL
----------
coffee_catalog (catalog_id)
  └─ green_coffee_inv (id, user, catalog_id)   ← your inventory
       ├─ roast_data (roast_id, coffee_id)      ← your roast profiles
       │    ├─ roast_temperatures               ← temperature curve
       │    └─ roast_events                     ← FC, drop, etc.
       ├─ coffee_sales (id, roast_id)           ← your sales
       └─ cupping notes stored on green_coffee_inv (aroma/body/acidity/sweetness/aftertaste)

CATALOG COMMANDS (no auth required)
-------------------------------------
Search the public catalog:
  purvey catalog search [options]
  Options (all optional):
    --origin <text>      country/region (e.g. "Ethiopia", "Colombia")
    --process <method>   natural|washed|honey
    --price-min <n>      min USD/lb
    --price-max <n>      max USD/lb
    --flavor <keywords>  comma-separated (e.g. "blueberry,citrus")
    --stocked            only currently stocked
    --limit <n>          max results (default: 10)
  Returns: array of catalog items with id, name, origin, process, flavor_notes, cost_lb, stocked

Get one catalog item by ID:
  purvey catalog get <catalog_id>
  Returns: single catalog item object

Catalog statistics:
  purvey catalog stats
  Returns: aggregate stats (count, avg_price, origins, processes, etc.)

INVENTORY COMMANDS (member role required)
------------------------------------------
List your green coffee inventory:
  purvey inventory list [options]
  Options:
    --stocked         only stocked beans
    --limit <n>       max results (default: 20)
  Returns: array with id, catalog_id, qty, cost, stocked, purchase_date, plus joined catalog fields

Get one inventory item:
  purvey inventory get <id>
  Returns: single inventory item

Add bean to inventory (REQUIRED: --catalog-id, --qty):
  purvey inventory add --catalog-id <id> --qty <lbs> [options]
  Options:
    --catalog-id <id>    [REQUIRED] coffee_catalog id
    --qty <lbs>          [REQUIRED] pounds purchased
    --cost <dollars>     cost per lb
    --tax-ship <dollars> tax + shipping cost
    --notes <text>       notes
    --purchase-date <YYYY-MM-DD>  defaults to today
    --form               interactive wizard
  Returns: created inventory item

Update inventory item:
  purvey inventory update <id> [options]
  Options (at least one required):
    --qty <lbs>          updated quantity
    --cost <dollars>     updated cost
    --tax-ship <dollars> updated tax/shipping
    --notes <text>       updated notes
    --stocked <true|false>  mark as stocked/unstocked
  Returns: updated inventory item

Delete inventory item:
  purvey inventory delete <id> [-y]
  -y skips confirmation prompt

ROAST COMMANDS (member role required)
---------------------------------------
List roast profiles:
  purvey roast list [options]
  Options:
    --coffee-id <id>  filter by inventory item id
    --limit <n>       max results (default: 20)
  Returns: array of roast profiles with roast_id, batch_name, roast_date, oz_in, oz_out

Get roast profile:
  purvey roast get <roast_id> [options]
  Options:
    --include-temps    include temperature curve data
    --include-events   include roast events (FC, drop, etc.)
  Returns: roast profile object

Create roast profile (REQUIRED: --coffee-id):
  purvey roast create --coffee-id <id> [options]
  Options:
    --coffee-id <id>       [REQUIRED] green_coffee_inv id
    --batch-name <name>    defaults to "CoffeeName YYYY-MM-DD"
    --oz-in <oz>           green weight in ounces
    --oz-out <oz>          roasted weight in ounces
    --roast-date <YYYY-MM-DD>  defaults to today
    --notes <text>         roast notes
    --form                 interactive wizard
  Returns: created roast profile

Delete roast profile:
  purvey roast delete <roast_id> [-y]

Import Artisan .alog file (REQUIRED: <file>, --coffee-id):
  purvey roast import <file.alog> --coffee-id <id> [options]
  Options:
    --coffee-id <id>       [REQUIRED] green_coffee_inv id
    --batch-name <name>    auto-generated if omitted
    --oz-in <oz>           extracted from .alog if omitted
    --roast-notes <text>   additional notes
    --form                 interactive wizard
  Returns: roast profile + milestone_events + control_events counts

Watch directory for new .alog files (REQUIRED: <directory>):
  purvey roast watch <directory> [options]
  Options:
    --coffee-id <id>    [REQUIRED unless --auto-match] green_coffee_inv id
    --batch-prefix <name>  prefix for batch names
    --auto-match           AI matches bean per file (requires member role; mutually exclusive with --coffee-id)
    --prompt-each          prompt for bean on each new file
    --resume               resume previous watch session
    --form                 interactive wizard
  Runs continuously (Ctrl+C to stop). Persists session for --resume.

SALES COMMANDS (member role required)
---------------------------------------
List sales:
  purvey sales list [--limit <n>]
  Returns: array with id, roast_id, oz, price, buyer, sell_date

Record sale (REQUIRED: --roast-id, --oz, --price):
  purvey sales record --roast-id <id> --oz <amount> --price <dollars> [options]
  Options:
    --roast-id <id>        [REQUIRED] roast_data id
    --oz <amount>          [REQUIRED] ounces sold
    --price <dollars>      [REQUIRED] sale price
    --buyer <name>         buyer name/identifier
    --sell-date <YYYY-MM-DD>  defaults to today
    --form                 interactive wizard
  Returns: created sale record

Update sale:
  purvey sales update <id> [--oz <n>] [--price <n>] [--buyer <name>] [--sell-date <date>]

Delete sale:
  purvey sales delete <id> [-y]

TASTING COMMANDS (member role required)
-----------------------------------------
Get tasting notes for a catalog item:
  purvey tasting get <catalog_id> [--filter user|supplier|both]
  --filter both (default): returns {supplier: {...}, user: {...}}
  --filter user:     only your cupping notes from green_coffee_inv
  --filter supplier: only the supplier's flavor notes from coffee_catalog

Rate a bean (REQUIRED: <inventory_id>, all score flags):
  purvey tasting rate <inventory_id> --aroma <1-5> --body <1-5> --acidity <1-5> --sweetness <1-5> --aftertaste <1-5> [options]
  Options:
    --aroma <1-5>       [REQUIRED in flag mode] integer 1-5
    --body <1-5>        [REQUIRED in flag mode] integer 1-5
    --acidity <1-5>     [REQUIRED in flag mode] integer 1-5
    --sweetness <1-5>   [REQUIRED in flag mode] integer 1-5
    --aftertaste <1-5>  [REQUIRED in flag mode] integer 1-5
    --brew-method       pour_over|french_press|espresso|etc
    --notes <text>      tasting notes
    --form              interactive wizard
  Note: <inventory_id> is green_coffee_inv.id, NOT catalog_id.
  Scores are stored on the green_coffee_inv row.

CONFIG COMMANDS
---------------
  purvey config list                      show all config
  purvey config get form-mode             get a value
  purvey config set form-mode true|false  set a value
  purvey config reset                     clear all config

Config keys:
  form-mode   true|false — when true, write commands auto-enter interactive
              wizard if required args are missing (default: false)

COMMON WORKFLOWS
----------------
1. Import a roast and rate it:
   purvey inventory list --stocked --pretty          # find your bean id
   purvey roast import roast.alog --coffee-id 42     # import
   purvey tasting rate 42 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4

2. Full workflow: buy → roast → sell:
   purvey catalog search --origin "Ethiopia" --stocked --pretty
   purvey inventory add --catalog-id 128 --qty 10 --cost 8.50
   purvey roast create --coffee-id 7 --oz-in 16 --batch-name "Ethiopia Guji Light"
   purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane"

3. Watch directory and auto-import roasts:
   purvey roast watch ~/artisan/ --coffee-id 7
   # or with AI bean matching:
   purvey roast watch ~/artisan/ --auto-match

4. Find a coffee and check tasting notes:
   purvey catalog search --flavor "blueberry,floral" --pretty
   purvey tasting get 128 --filter both --pretty

ERROR HANDLING
--------------
Exit 0: success
Exit 1: error (auth failure, not found, validation error, API error)
Errors go to stderr as: Error: <message>

Common errors:
  "Not logged in"        → run: purvey auth login [--headless]
  "Not found"            → check the ID; must be yours (RLS enforced)
  "INVALID_ARGUMENT"     → check flags; use --form for interactive mode
  "--auto-match and --coffee-id are mutually exclusive" → use one or the other

ID TYPES (avoid confusion)
---------------------------
catalog_id       → coffee_catalog table; used with: catalog get, inventory add --catalog-id, tasting get
inventory_id     → green_coffee_inv table (your beans); used with: inventory get/update/delete, roast --coffee-id, tasting rate
roast_id         → roast_data table; used with: roast get/delete, sales --roast-id
sale_id          → coffee_sales table; used with: sales update/delete
`.trim();

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey context`
 * Outputs a comprehensive CLI reference for AI agent onboarding.
 * Optimized for token efficiency — dense, structured, no fluff.
 */
export function buildContextCommand(): Command {
  return new Command('context')
    .description('Output full CLI reference for AI agent onboarding')
    .addHelpText(
      'after',
      `
Examples:
  purvey context                  # print full reference to stdout
  purvey context | head -50       # preview first section
  purvey context > cli-ref.txt    # save to file
`
    )
    .action(() => {
      console.log(CONTEXT_TEXT);
    });
}
