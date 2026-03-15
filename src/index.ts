#!/usr/bin/env node
import { Command } from 'commander';
import { buildAuthCommand } from './commands/auth.js';
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
  .addHelpText(
    'after',
    `
Examples:
  $ prvrs auth login          # Authenticate via Google
  $ prvrs auth status         # Check login state
  $ prvrs auth logout         # Clear credentials
  $ prvrs --help              # Show this help

Docs: https://purveyors.io/docs/cli
`
  );

// Register subcommands
program.addCommand(buildAuthCommand());

// Parse and dispatch
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
