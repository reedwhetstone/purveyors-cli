#!/usr/bin/env node
import { Command } from 'commander';
import { buildAuthCommand } from './commands/auth.js';
import { buildCatalogCommand } from './commands/catalog.js';
import { buildConfigCommand } from './commands/config.js';
import { buildContextCommand } from './commands/context.js';
import { buildInventoryCommand } from './commands/inventory.js';
import { buildRoastCommand } from './commands/roast.js';
import { buildSalesCommand } from './commands/sales.js';
import { buildTastingCommand } from './commands/tasting.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json at runtime
let version = '0.0.1';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  version = pkg.version ?? version;
} catch {
  // Fallback to hardcoded version
}

const program = new Command();

program
  .name('purvey')
  .description('The official CLI for purveyors.io. Coffee intelligence from your terminal')
  .version(version, '-v, --version', 'Print version')
  .option('--pretty', 'Pretty-print JSON output with colors')
  .option('--csv', 'Output results as CSV where supported')
  .addHelpText(
    'after',
    `
Authentication:
  auth login        Log in to purveyors.io (--headless for agents)
  auth status       Show current login status and role
  auth logout       Clear stored credentials

Catalog (viewer session required in current CLI implementation):
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

Configuration:
  config list       Show all config values
  config get        Get a config value
  config set        Set a config value
  config reset      Reset config to defaults

Agent Tools:
  context           Output the dense CLI reference for agents

Global Options:
  --pretty          Pretty-print JSON output
  --csv             Output array results as CSV where supported
  --help            Show help for any command
  --version         Show version number

Examples:
  $ purvey auth login --headless
  $ purvey catalog search --origin "Ethiopia" --process "natural" --pretty
  $ purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
  $ purvey inventory list --stocked --pretty
  $ purvey roast import my-roast.alog --coffee-id 128
  $ purvey roast watch ~/artisan/ --auto-match
  $ purvey tasting rate 42 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  $ purvey context

Documentation: https://github.com/reedwhetstone/purveyors-cli
Agent reference: purvey context
`
  );

// Register subcommands
program.addCommand(buildAuthCommand());
program.addCommand(buildCatalogCommand());
program.addCommand(buildConfigCommand());
program.addCommand(buildContextCommand());
program.addCommand(buildInventoryCommand());
program.addCommand(buildRoastCommand());
program.addCommand(buildSalesCommand());
program.addCommand(buildTastingCommand());

// Parse and dispatch
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
