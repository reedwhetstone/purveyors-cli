import { Command, type CommanderError } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildAuthCommand } from './commands/auth.js';
import { buildCatalogCommand } from './commands/catalog.js';
import { buildConfigCommand } from './commands/config.js';
import { buildContextCommand } from './commands/context.js';
import { buildInventoryCommand } from './commands/inventory.js';
import { buildManifestCommand } from './commands/manifest.js';
import { buildRoastCommand } from './commands/roast.js';
import { buildSalesCommand } from './commands/sales.js';
import { buildTastingCommand } from './commands/tasting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function applyProcessBoundarySettings(command: Command): void {
  command.configureOutput({
    outputError: () => {
      // Route Commander parse failures through the top-level fatal() contract
      // instead of printing raw stderr before exitOverride throws.
    },
  });

  command.exitOverride((error: CommanderError) => {
    if (error.exitCode === 0) {
      process.exit(0);
    }

    throw error;
  });

  for (const subcommand of command.commands) {
    applyProcessBoundarySettings(subcommand);
  }
}

export function getCliVersion(): string {
  let version = '0.0.1';

  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
      version?: string;
    };
    version = pkg.version ?? version;
  } catch {
    // Fallback to hardcoded version
  }

  return version;
}

export function createProgram(version = getCliVersion()): Command {
  const program = new Command();

  program
    .name('purvey')
    .description('The official CLI for purveyors.io. Coffee intelligence from your terminal')
    .version(version, '-v, --version', 'Print version')
    .option('--json', 'Output compact JSON explicitly (same as the default)')
    .option('--pretty', 'Pretty-print JSON output with colors')
    .option('--csv', 'Output results as CSV where supported')
    .addHelpText(
      'after',
      `
Authentication:
  auth login        Log in to purveyors.io (--headless for agents)
  auth status       Show current login status and role
  auth logout       Clear stored credentials

Catalog (viewer role required, authentication needed):
  catalog search    Search the coffee catalog with filters
  catalog get       Get details for a specific coffee by ID
  catalog stats     Aggregate statistics for the catalog
  catalog similar   Find similar coffees by catalog ID

Personal Data (member role required):
  inventory list    List your green coffee inventory
  inventory get     Get a single inventory item
  inventory add     Add a bean to your inventory
  inventory update  Update an inventory item
  inventory delete  Delete an inventory item
  roast list        List your roast profiles
  roast get         Get a single roast profile
  roast create      Create a new roast profile
  roast update      Update a roast profile
  roast delete      Delete a roast profile
  roast import      Import an Artisan .alog roast file
  roast watch       Watch a directory for new .alog files
  sales list        List your sales records
  sales record      Record a new sale
  sales update      Update a sale record
  sales delete      Delete a sale record
  tasting get       Get tasting notes for a coffee
  tasting rate      Rate a coffee bean with cupping scores

Local and reference commands (no pre-existing session required):
  config list       Show all config values
  config get        Get a config value
  config set        Set a config value
  config reset      Reset config to defaults
  context           Output the dense human-readable operator reference; use --json/--pretty only for manifest parity
  manifest          Output the preferred stable machine-readable CLI contract for agents/scripts

Global Options:
  --json            Output compact JSON explicitly
  --pretty          Pretty-print JSON output
  --csv             Output array results as CSV where supported
  --help            Show help for any command
  --version         Show version number

Examples:
  $ purvey auth login --headless
  $ purvey catalog search --origin "Ethiopia" --process "natural" --pretty
  $ purvey catalog similar 1182 --threshold 0.85 --stocked-only --json | jq '.[0]'
  $ purvey inventory list --stocked --pretty
  $ purvey roast import my-roast.alog --coffee-id 7
  $ purvey roast watch ~/artisan/ --auto-match
  $ purvey tasting rate 42 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  $ purvey --help
  $ purvey context
  $ purvey manifest
  $ purvey manifest --pretty
  $ purvey context --json > cli-manifest.json

CLI docs:            https://purveyors.io/docs/cli/overview
API docs:            https://purveyors.io/docs/api/overview
Repository:          https://github.com/reedwhetstone/purveyors-cli
npm package:         https://www.npmjs.com/package/@purveyors/cli
Quick discovery:  purvey --help
Human reference:  purvey context
JSON manifest:    purvey manifest
Module import:    @purveyors/cli/manifest
`
    );

  program.addCommand(buildAuthCommand());
  program.addCommand(buildCatalogCommand());
  program.addCommand(buildConfigCommand());
  program.addCommand(buildContextCommand());
  program.addCommand(buildInventoryCommand());
  program.addCommand(buildManifestCommand());
  program.addCommand(buildRoastCommand());
  program.addCommand(buildSalesCommand());
  program.addCommand(buildTastingCommand());

  applyProcessBoundarySettings(program);

  return program;
}
