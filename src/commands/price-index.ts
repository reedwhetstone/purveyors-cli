import { Command } from 'commander';
import type { PriceIndexQuery, paths } from '@purveyors/sdk';
import { outputData } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import {
  createOptionalParchmentClient,
  createParchmentClient,
  unwrapParchment,
} from '../lib/parchment.js';
import { CLI_NUMERIC_BOUNDS } from '../lib/numeric-contracts.js';
import { parseStrictPositiveCount } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

type PriceComparisonsQuery = NonNullable<
  paths['/v1/price-index/comparisons']['get']['parameters']['query']
>;
type PriceComparisonQuery = paths['/v1/price-index/comparison']['get']['parameters']['query'];
type PriceIndexHistoryQuery = NonNullable<
  paths['/v1/price-index/history']['get']['parameters']['query']
>;

const COMPARISONS_WHOLESALE = ['true', 'false', 'all'] as const;
const ORDERS = ['asc', 'desc'] as const;

function parsePositiveInt(rawValue: string, flag: string, max?: number): number {
  const parsed = parseStrictPositiveCount(rawValue, max);
  if (!Number.isFinite(parsed)) {
    const requirement = max ? `an integer between 1 and ${max}` : 'a positive integer';
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${rawValue}". Must be ${requirement}.`
    );
  }
  return parsed;
}

function parseWholesale(rawValue: string): 'true' | 'false' {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return 'true';
  if (normalized === 'false') return 'false';
  throw new PrvrsError(
    'INVALID_ARGUMENT',
    `Invalid --wholesale: "${rawValue}". Must be "true" or "false".`
  );
}

function parseEnum<T extends string>(rawValue: string, flag: string, values: readonly T[]): T {
  const value = rawValue.trim().toLowerCase();
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new PrvrsError(
    'INVALID_ARGUMENT',
    `Invalid ${flag}: "${rawValue}". Must be one of: ${values.join(', ')}.`
  );
}

function parseIsoDate(rawValue: string, flag: string): string {
  const value = rawValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${rawValue}". Must be an ISO date (YYYY-MM-DD).`
    );
  }
  return value;
}

function toFlag(attributeName: string): string {
  return `--${attributeName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * Resolve a `price-index <subcommand>` invocation's own options.
 *
 * The parent `price-index` command keeps its snapshot filters (`--origin`,
 * `--from`, `--wholesale`, `--page`, `--limit`, ...), and Commander assigns a
 * flag to the parent whenever both levels declare it. Subcommands therefore
 * read their declared options from both levels and reject parent-only filters
 * instead of silently ignoring them.
 */
function resolveSubcommandOptions(cmd: Command): Record<string, unknown> {
  const own = new Set(cmd.options.map((option) => option.attributeName()));
  const parentOptions = cmd.parent?.opts() ?? {};

  for (const key of Object.keys(parentOptions)) {
    if (!own.has(key)) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `${toFlag(key)} is not supported by \`purvey price-index ${cmd.name()}\`.`
      );
    }
  }

  return { ...parentOptions, ...cmd.opts() };
}

function requireOption(opts: Record<string, unknown>, key: string, cmd: Command): string {
  const value = opts[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `\`purvey price-index ${cmd.name()}\` requires ${toFlag(key)}.`
    );
  }
  return value;
}

function buildComparisonsCommand(): Command {
  return new Command('comparisons')
    .description('Available exact 30-day matched price comparisons with significance')
    .option('--wholesale <true|false|all>', 'Market scope (API default when omitted)')
    .addHelpText(
      'after',
      `
Examples:
  purvey price-index comparisons --pretty
  purvey price-index comparisons --wholesale all --json

Notes:
  The API discovers origins with an exact 30-day matched comparison ending on the
  latest completed observation day; an empty list means none qualify.
  Each comparison carries its significance read verbatim. classification is null
  until eight baseline windows exist, which means "not enough history", not "quiet".
  Requires Parchment Intelligence access, enforced by the API.`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const opts = resolveSubcommandOptions(cmd);

        const query: PriceComparisonsQuery = {};
        if (opts.wholesale !== undefined)
          query.wholesale = parseEnum(
            opts.wholesale as string,
            '--wholesale',
            COMPARISONS_WHOLESALE
          );

        const client = await createParchmentClient('member');
        const data = unwrapParchment(
          await client.priceIndex.comparisons(query),
          'price-index comparisons'
        );
        outputData(data, globalOpts);
      })
    );
}

function buildComparisonCommand(): Command {
  return new Command('comparison')
    .description('Matched-listing price comparison for one origin between two exact dates')
    .option('--origin <origin>', 'Origin to compare (required)')
    .option('--from <date>', 'Starting UTC date, YYYY-MM-DD (required)')
    .option('--to <date>', 'Ending UTC date, YYYY-MM-DD, within 365 days of --from (required)')
    .option('--wholesale <true|false>', 'Market scope (API default when omitted)')
    .addHelpText(
      'after',
      `
Examples:
  purvey price-index comparison --origin "Ethiopia" --from 2026-08-31 --to 2026-09-30 --pretty
  purvey price-index comparison --origin "Colombia" --from 2026-06-01 --to 2026-09-01 --wholesale true --json

Notes:
  Supplier-balanced fresh matched prices only; status "insufficient_fresh_coverage"
  returns a null changePercent, never zero.
  Requires Parchment Intelligence access, enforced by the API.`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const opts = resolveSubcommandOptions(cmd);

        const query: PriceComparisonQuery = {
          origin: requireOption(opts, 'origin', cmd),
          from: parseIsoDate(requireOption(opts, 'from', cmd), '--from'),
          to: parseIsoDate(requireOption(opts, 'to', cmd), '--to'),
        };
        if (opts.wholesale !== undefined)
          query.wholesale = parseWholesale(opts.wholesale as string);

        const client = await createParchmentClient('member');
        const data = unwrapParchment(
          await client.priceIndex.comparison(query),
          'price-index comparison'
        );
        outputData(data, globalOpts);
      })
    );
}

function buildHistoryCommand(): Command {
  const { priceIndexHistoryLimit, priceIndexHistoryWindowDays } = CLI_NUMERIC_BOUNDS;

  return new Command('history')
    .description('Tier-one price-index chart history (public up to 90 days)')
    .option(
      '--window-days <n>',
      `Trailing window in days (${priceIndexHistoryWindowDays.minimum}-${priceIndexHistoryWindowDays.maximum})`
    )
    .option('--page <n>', '1-based page number')
    .option(
      '--limit <n>',
      `Results per page (${priceIndexHistoryLimit.minimum}-${priceIndexHistoryLimit.maximum})`
    )
    .option('--order <asc|desc>', 'Snapshot ordering (API default asc)')
    .addHelpText(
      'after',
      `
Examples:
  purvey price-index history --pretty
  purvey price-index history --window-days 30 --order desc --json
  purvey price-index history --window-days 365 --limit 500 --json

Notes:
  Windows up to 90 days are public and run without credentials; 91-365 days
  require Parchment Intelligence access, enforced by the API.`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const opts = resolveSubcommandOptions(cmd);

        const query: PriceIndexHistoryQuery = {};
        if (opts.windowDays !== undefined)
          query.windowDays = parsePositiveInt(
            opts.windowDays as string,
            '--window-days',
            priceIndexHistoryWindowDays.maximum
          );
        if (opts.page !== undefined) query.page = parsePositiveInt(opts.page as string, '--page');
        if (opts.limit !== undefined)
          query.limit = parsePositiveInt(
            opts.limit as string,
            '--limit',
            priceIndexHistoryLimit.maximum
          );
        if (opts.order !== undefined)
          query.order = parseEnum(opts.order as string, '--order', ORDERS);

        const client = await createOptionalParchmentClient();
        const data = unwrapParchment(await client.priceIndex.history(query), 'price-index history');
        outputData(data, globalOpts);
      })
    );
}

/**
 * `purvey price-index` — Parchment Price Index reads.
 * The bare command returns aggregate snapshots (price-index entitlement);
 * subcommands expose matched comparisons (Parchment Intelligence) and chart
 * history (public up to 90 days). Entitlements are enforced by the API.
 */
export function buildPriceIndexCommand(): Command {
  const priceIndex = new Command('price-index')
    .description('Parchment Price Index snapshots, matched comparisons, and chart history')
    .option('--origin <origin>', 'Filter by origin')
    .option('--process <method>', 'Filter by process method')
    .option('--grade <grade>', 'Filter by grade')
    .option('--from <date>', 'Include snapshots on/after this ISO date (YYYY-MM-DD)')
    .option('--to <date>', 'Include snapshots on/before this ISO date (YYYY-MM-DD)')
    .option('--wholesale <true|false>', 'Filter by wholesale pricing scope')
    .option('--page <n>', '1-based page number')
    .option(
      '--limit <n>',
      `Results per page (${CLI_NUMERIC_BOUNDS.priceIndexLimit.minimum}-${CLI_NUMERIC_BOUNDS.priceIndexLimit.maximum})`
    )
    .addHelpText(
      'after',
      `
Examples:
  purvey price-index --pretty
  purvey price-index --origin "Ethiopia" --json
  purvey price-index --from 2026-01-01 --to 2026-06-30 --pretty
  purvey price-index --wholesale true --limit 25 --json
  purvey price-index comparisons --pretty
  purvey price-index history --window-days 30 --json

Notes:
  The bare command returns aggregate snapshots and requires a Purveyors session or
  API key with price-index (PPI) access.
  Set PARCHMENT_API_KEY or PURVEYORS_API_KEY to use an API key instead of the logged-in session.`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const query: PriceIndexQuery = {};
        if (opts.origin !== undefined) query.origin = opts.origin as string;
        if (opts.process !== undefined) query.process = opts.process as string;
        if (opts.grade !== undefined) query.grade = opts.grade as string;
        if (opts.from !== undefined) query.from = opts.from as string;
        if (opts.to !== undefined) query.to = opts.to as string;
        if (opts.wholesale !== undefined)
          query.wholesale = parseWholesale(opts.wholesale as string);
        if (opts.page !== undefined) query.page = parsePositiveInt(opts.page as string, '--page');
        if (opts.limit !== undefined)
          query.limit = parsePositiveInt(
            opts.limit as string,
            '--limit',
            CLI_NUMERIC_BOUNDS.priceIndexLimit.maximum
          );

        const client = await createParchmentClient('member');
        const result = await client.priceIndex.list(query);
        const data = unwrapParchment(result, 'price-index');
        outputData(data, globalOpts);
      })
    );

  priceIndex.addCommand(buildComparisonsCommand());
  priceIndex.addCommand(buildComparisonCommand());
  priceIndex.addCommand(buildHistoryCommand());

  return priceIndex;
}
