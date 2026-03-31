import { Command } from 'commander';

// This text is intentionally dense. An agent should be able to read it once,
// then use the CLI correctly without hunting through help output.

const CONTEXT_TEXT = `
PURVEY CLI - Agent Reference
============================
Official CLI for purveyors.io. Node.js 20+.
Credentials file: ~/.config/purvey/credentials.json
Config file: ~/.config/purvey/config.json

ROLES
-----
viewer  valid authenticated session; required for catalog commands
member  required for inventory, roast, sales, and tasting commands

AUTH
----
Interactive login:
  purvey auth login

Headless login:
  purvey auth login --headless
  1. CLI prints a Google OAuth URL
  2. User opens it in any browser and signs in
  3. User pastes the full callback URL back into the terminal

Status:
  purvey auth status
  purvey auth status --pretty

Logout:
  purvey auth logout

OUTPUT
------
Most commands emit compact JSON to stdout by default.
Use --json to request compact JSON explicitly.
Use --pretty for indented JSON.
Use --csv for array-shaped results that support CSV output.
User feedback goes to stderr.

Important exception:
- auth status prints human-readable output in an interactive TTY unless --json, --pretty, or --csv is passed; otherwise it emits structured output

ID MAP
------
catalog_id      coffee_catalog row; used by catalog get, inventory add --catalog-id, tasting get, roast list --catalog-id
inventory_id    green_coffee_inv row; used by inventory get/update/delete, roast --coffee-id, roast list --coffee-id, tasting rate
roast_id        roast_data row; used by roast get/delete, roast list --roast-id, sales --roast-id
sale_id         coffee_sales row; used by sales update/delete

COMMANDS
--------
auth
  login [--headless]
  status
  logout

catalog
  search [options]
    --origin <text>
    --process <method>
    --price-min <n>
    --price-max <n>
    --flavor <keywords>
    --name <text>
    --supplier <name>
    --ids <n,n,...>
    --variety <text>
    --drying-method <text>
    --stocked-days <n>
    --stocked
    --sort <price|price-desc|name|origin|newest>
    --offset <n>
    --limit <n>
  get <catalog_id>
  stats
  similar <catalog_id>
    --threshold <0-1>     default 0.70
    --limit <n>           default 10
    --stocked-only

inventory (member)
  list
    --stocked
    --catalog-id <catalog_id>
    --purchase-date-start <YYYY-MM-DD>
    --purchase-date-end <YYYY-MM-DD>
    --origin <country>
    --limit <n>
  get <inventory_id>
  add
    --catalog-id <id>     required in flag mode
    --qty <lbs>           required in flag mode
    --cost <dollars>
    --tax-ship <dollars>
    --notes <text>
    --purchase-date <YYYY-MM-DD>
    --form
  update <inventory_id>
    --qty <lbs>
    --cost <dollars>
    --tax-ship <dollars>
    --notes <text>
    --stocked <true|false>
  delete <inventory_id> [--yes]

roast (member)
  list
    --coffee-id <inventory_id>
    --roast-id <roast_id>
    --batch-name <text>
    --coffee-name <text>
    --date-start <YYYY-MM-DD>
    --date-end <YYYY-MM-DD>
    --stocked
    --catalog-id <catalog_id>
    --limit <n>
  get <roast_id>
    --include-temps
    --include-events
  create
    --coffee-id <inventory_id>   required in flag mode
    --batch-name <name>
    --oz-in <oz>
    --oz-out <oz>
    --roast-date <YYYY-MM-DD>
    --notes <text>
    --form
  update <roast_id>
    --notes <text>
    --oz-out <oz>
    --batch-name <name>
    --targets <text>
  delete <roast_id> [--yes]
  import [file]
    --coffee-id <inventory_id>   required in flag mode
    --batch-name <name>
    --oz-in <oz>
    --roast-notes <text>
    --form
  watch [directory]
    --coffee-id <inventory_id>   required unless --auto-match
    --batch-prefix <name>
    --prompt-each
    --auto-match                 mutually exclusive with --coffee-id
    --resume
    --form

sales (member)
  list
    --roast-id <roast_id>
    --date-start <YYYY-MM-DD>
    --date-end <YYYY-MM-DD>
    --buyer <name>
    --limit <n>
  record
    --roast-id <roast_id>   required in flag mode
    --oz <amount>           required in flag mode
    --price <dollars>       required in flag mode
    --buyer <name>
    --sell-date <YYYY-MM-DD>
    --form
  update <sale_id>
    --oz <amount>
    --price <dollars>
    --buyer <name>
    --sell-date <YYYY-MM-DD>
  delete <sale_id> [--yes]

tasting (member)
  get <catalog_id>
    --filter <user|supplier|both>   default both
  rate [inventory_id]
    --aroma <1-5>        required in flag mode
    --body <1-5>         required in flag mode
    --acidity <1-5>      required in flag mode
    --sweetness <1-5>    required in flag mode
    --aftertaste <1-5>   required in flag mode
    --brew-method <method>
    --notes <text>
    --form

config
  list
  get <key>
  set <key> <value>
  reset

Current config keys:
  form-mode  true|false

WORKFLOWS
---------
Catalog -> inventory:
  purvey catalog search --origin "Ethiopia" --stocked --pretty
  purvey inventory add --catalog-id 128 --qty 10 --cost 8.50

Import a roast from Artisan:
  purvey inventory list --stocked --pretty
  purvey roast import ~/artisan/ethiopia.alog --coffee-id 7 --pretty

Watch a folder for new roasts:
  purvey roast watch ~/artisan/ --coffee-id 7
  purvey roast watch ~/artisan/ --auto-match
  purvey roast watch --resume

Rate coffee and record a sale:
  purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  purvey sales record --roast-id 123 --oz 12 --price 22.00 --buyer "Jane Smith"

ERROR PATTERNS
--------------
Not logged in:
  run purvey auth login or purvey auth login --headless

Wrong ID type:
  verify whether the command wants catalog_id, inventory_id, roast_id, or sale_id

Missing required args in write commands:
  pass the required flags or use --form

Mutually exclusive watch flags:
  roast watch forbids using --auto-match together with --coffee-id
`.trim();

export function buildContextCommand(): Command {
  return new Command('context')
    .description('Output full CLI reference for AI agent onboarding')
    .addHelpText(
      'after',
      `
Examples:
  purvey context
  purvey context | head -50
  purvey context > cli-reference.txt
`
    )
    .action(() => {
      console.log(CONTEXT_TEXT);
    });
}
