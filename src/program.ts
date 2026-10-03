import { Command, type CommanderError, type Option } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildAuthCommand } from './commands/auth.js';
import { buildCatalogCommand } from './commands/catalog.js';
import { buildConfigCommand } from './commands/config.js';
import { buildContextCommand } from './commands/context.js';
import { buildInventoryCommand } from './commands/inventory.js';
import { buildManifestCommand } from './commands/manifest.js';
import { buildMarketCommand } from './commands/market.js';
import { buildPriceIndexCommand } from './commands/price-index.js';
import { buildProcurementCommand } from './commands/procurement.js';
import { buildReferenceProfileCommand } from './commands/reference-profile.js';
import { buildRoastCommand } from './commands/roast.js';
import { buildSalesCommand } from './commands/sales.js';
import { buildSkillCommand } from './commands/skill.js';
import { buildTastingCommand } from './commands/tasting.js';
import { getCliManifest, type CliOptionContract } from './lib/manifest.js';

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

/** Help text for one option, built from its manifest entry. */
function optionHelp(contract: CliOptionContract & { description: string }, option: Option): string {
  const extras: string[] = [];
  if (contract.minimum !== undefined && contract.maximum !== undefined) {
    extras.push(`${contract.minimum}-${contract.maximum}`);
  }
  // Commander already prints defaults it applies itself.
  if (contract.defaultValue !== undefined && option.defaultValue === undefined) {
    extras.push(`default: ${String(contract.defaultValue)}`);
  }
  const required = contract.requiredInFlagMode ? '[required unless --form] ' : '';
  return `${required}${contract.description}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
}

function describeOptions(options: readonly Option[], contracts: CliOptionContract[] = []): void {
  for (const option of options) {
    const contract = contracts.find(
      (candidate) => candidate.flags.match(/--[a-z0-9-]+/i)?.[0] === option.long
    );
    if (contract?.description) {
      option.description = optionHelp({ ...contract, description: contract.description }, option);
    }
  }
}

function applyHelpOptionDescription(command: Command, description: string): void {
  command.helpOption('-h, --help', description);
  for (const subcommand of command.commands) {
    applyHelpOptionDescription(subcommand, description);
  }
}

/**
 * Option help comes from the manifest, so `--help`, `purvey manifest`, the agent
 * skill, and the public CLI reference describe every flag in the same words.
 */
function applyManifestOptionHelp(program: Command): void {
  const manifest = getCliManifest();
  describeOptions(program.options, manifest.globalOptions);
  // Commander builds each command's -h, --help outside `options`.
  const help = manifest.globalOptions.find((option) => option.flags === '--help');
  if (help?.description) applyHelpOptionDescription(program, help.description);
  for (const group of manifest.commandGroups) {
    const groupCommand = program.commands.find((command) => command.name() === group.name);
    if (!groupCommand) continue;
    if (group.command) describeOptions(groupCommand.options, group.command.options);
    for (const subcommand of group.subcommands ?? []) {
      const command = groupCommand.commands.find(
        (candidate) => candidate.name() === subcommand.name
      );
      if (command) describeOptions(command.options, subcommand.options);
    }
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
    .version(version, '-v, --version')
    .option('--json')
    .option('--pretty')
    .option('--csv')
    .addHelpText(
      'after',
      `
Authentication:
  auth login        Log in to purveyors.io (--headless for agents)
  auth status       Show current login status and role
  auth whoami       Show the identity, plan, scopes, and capabilities of your credential
  auth logout       Clear stored credentials

Catalog (any signed-in account or API key with catalog:read):
  catalog search    Search the coffee catalog with filters
  catalog get       Get details for a specific coffee by ID
  catalog stats     Aggregate statistics for the catalog
  catalog facets    Counted facet values for filter discovery
  catalog compare   Compare 2 to 6 coffees side by side, priced at your quantity
  catalog price-history Daily smallest-tier price history for one coffee
  catalog grades    Explain grade codes like KE:AA, ET:G1, and PREP:EP
  catalog rank      Rank catalog coffees for a goal such as premium or value
  catalog rank-premium  Rank premium catalog candidates by Purveyor Score
  catalog supplier-rank Rank suppliers by average Purveyor Score
  catalog similar   Beta: find likely same-lot candidates and similar coffees by catalog ID

Personal Data (member role required):
  inventory list    List your green coffee inventory
  inventory get     Get a single inventory item
  inventory add     Add a bean to your inventory
  inventory update  Update an inventory item
  inventory delete  Delete an inventory item
  roast list        List your roast profiles
  roast get         Get a single roast profile
  roast chart       Get sampled chart data and the chart revision for a roast
  roast create      Create a new roast profile
  roast update      Update a roast profile
  roast delete      Delete a roast profile
  roast import      Import an Artisan .alog roast file
  roast from-reference  Create a roast from a saved reference profile's Artisan file
  roast watch       Watch a directory for new .alog files
  sales list        List your sales records
  sales record      Record a new sale
  sales update      Update a sale record
  sales delete      Delete a sale record
  tasting get       Get tasting notes for a coffee
  tasting rate      Rate a coffee bean with cupping scores

Market intelligence (filtered views require Parchment Intelligence access):
  market signals      Actionable value signals (public summary via --summary)
  market stats        Price movement-significance stats (public retail summary)
  market metadata     Metadata-trend index (public process/retail/month slice)
  market overview     Aggregate market overview (any signed-in session or API key)
  market evidence     Named lots and supplier evidence (Intelligence access)
  price-index         Parchment Price Index aggregate snapshots
  price-index comparisons  Available 30-day matched comparisons with significance
  price-index comparison   Matched comparison for one origin between two dates
  price-index history      Chart history (public up to 90 days)
  procurement list    List your saved sourcing briefs
  procurement get     Get a saved sourcing brief by ID
  procurement matches Page through catalog matches for a brief

Studio reference profiles (member credential plus Studio access):
  reference-profile list     List your saved reference profiles
  reference-profile get      Get a profile and its current revision
  reference-profile chart    Get a typed chart for a revision
  reference-profile compare  Compare two roast or reference revisions
  reference-profile import   Upload an Artisan file as a reference profile
  reference-profile preview  Preview bounded temperature adjustments
  reference-profile roasts   List past roasts a plan can be built from
  reference-profile preview-from-roast  Preview a plan built from a past roast
  reference-profile from-roast  Save a past roast as a reference profile
  reference-profile save     Save an immutable generated plan
  reference-profile export   Download a saved plan as an unsigned .alog

Local and reference commands (no pre-existing credentials required):
  config list       Show all config values
  config get        Get a config value
  config set        Set a config value
  config reset      Reset config to defaults
  context           Output the dense human-readable operator reference; use --json/--pretty only for manifest parity
  manifest          Output the preferred stable machine-readable CLI contract for agents/scripts
  skill print       Print the agent skill (SKILL.md, workflows.md) generated from the manifest
  skill install     Install them for Claude Code, Codex/Cursor (~/.agents/skills), or AGENTS.md

Global Options:
${getCliManifest()
  .globalOptions.map((option) => `  ${option.flags.padEnd(18, ' ')}${option.description}`)
  .join('\n')}

Examples:
  $ purvey auth login --headless
  $ purvey catalog search --origin "Ethiopia" --process "natural" --pretty
  $ purvey catalog rank-premium --stocked --limit 10 --pretty
  $ purvey catalog supplier-rank --stocked --min-coffees 3 --json
  $ purvey catalog similar 1182 --threshold 0.85 --stocked-only --json | jq '.data.groups'
  $ purvey inventory list --stocked --pretty
  $ purvey roast import my-roast.alog --coffee-id 7
  $ purvey reference-profile list --pretty
  $ purvey reference-profile preview 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --request changes.json --pretty
  $ purvey roast watch ~/artisan/ --auto-match
  $ purvey tasting rate 42 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  $ purvey --help
  $ purvey context
  $ purvey manifest
  $ purvey manifest --pretty
  $ purvey skill install --target claude
  $ purvey context --json > cli-manifest.json

CLI docs:            https://purveyors.io/docs/cli/overview
API reference:       https://api.purveyors.io/docs
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
  program.addCommand(buildMarketCommand());
  program.addCommand(buildPriceIndexCommand());
  program.addCommand(buildProcurementCommand());
  program.addCommand(buildReferenceProfileCommand());
  program.addCommand(buildRoastCommand());
  program.addCommand(buildSalesCommand());
  program.addCommand(buildSkillCommand(version));
  program.addCommand(buildTastingCommand());

  applyManifestOptionHelp(program);
  applyProcessBoundarySettings(program);

  return program;
}
