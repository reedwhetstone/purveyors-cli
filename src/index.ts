#!/usr/bin/env node
import { Command } from 'commander';
import { buildAuthCommand } from './commands/auth.js';
import { buildCatalogCommand } from './commands/catalog.js';
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
  .name('prvrs')
  .description('The official CLI for purveyors.io — coffee intelligence from your terminal')
  .version(version, '-v, --version', 'Print version')
  .option('--pretty', 'Pretty-print JSON output with colors')
  .option('--csv', 'Output results as CSV (useful for piping to spreadsheets)')
  .addHelpText(
    'after',
    `
Examples:
  $ prvrs auth login                      # Authenticate via Google
  $ prvrs auth status                     # Check login state
  $ prvrs catalog search --origin Ethiopia --stocked
  $ prvrs catalog get 42
  $ prvrs catalog stats
  $ prvrs inventory list --stocked
  $ prvrs inventory get 7
  $ prvrs inventory add --catalog-id 42 --qty 5 --cost 28.50
  $ prvrs inventory update 7 --stocked true
  $ prvrs inventory delete 7
  $ prvrs roast list --limit 5
  $ prvrs roast get 123 --include-temps
  $ prvrs roast create --coffee-id 7 --batch-name "Ethiopia Guji" --oz-in 16
  $ prvrs roast delete 123
  $ prvrs sales list
  $ prvrs sales record --roast-id 123 --oz 12 --price 22.00
  $ prvrs sales update 5 --price 24.00
  $ prvrs sales delete 5
  $ prvrs tasting get 42 --filter both
  $ prvrs tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  $ prvrs --help                          # Show this help

Docs: https://purveyors.io/docs/cli
`
  );

// Register subcommands
program.addCommand(buildAuthCommand());
program.addCommand(buildCatalogCommand());
program.addCommand(buildInventoryCommand());
program.addCommand(buildRoastCommand());
program.addCommand(buildSalesCommand());
program.addCommand(buildTastingCommand());

// Parse and dispatch
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
