import { Command } from 'commander';
import type { MarketSignalsQuery, PriceIndexStatsQuery, MetadataIndexQuery } from '@purveyors/sdk';
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

const SIGNAL_TYPES = ['price_drop', 'below_market', 'value_quality'] as const;
const MARKETS = ['retail', 'wholesale', 'all'] as const;
const WINDOWS = ['7d', '30d'] as const;
const DIMENSIONS = ['process', 'disclosure', 'score'] as const;
const GRAINS = ['week', 'month'] as const;

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

function parseIntRange(rawValue: string, flag: string, min: number, max: number): number {
  const parsed = parsePositiveInt(rawValue, flag);
  if (parsed < min || parsed > max) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${rawValue}". Must be between ${min} and ${max}.`
    );
  }
  return parsed;
}

function parseNumber(rawValue: string, flag: string): number {
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError('INVALID_ARGUMENT', `Invalid ${flag}: "${rawValue}". Must be a number.`);
  }
  return parsed;
}

function parseEnum<T extends string>(rawValue: string, flag: string, values: readonly T[]): T {
  const value = rawValue.trim();
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

/** Repeatable/comma-separated `--type` collector preserving all requested types. */
function collectSignalTypes(rawValue: string, previous: string[] = []): string[] {
  const parts = rawValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!(SIGNAL_TYPES as readonly string[]).includes(part)) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `Invalid --type: "${part}". Must be one of: ${SIGNAL_TYPES.join(', ')}.`
      );
    }
  }
  return [...previous, ...parts];
}

/**
 * `purvey market` — Market Index decision surface reads over the canonical API.
 * Public teaser slices work unauthenticated; entitled slices require a session
 * or API key with Parchment Intelligence, enforced server-side.
 */
export function buildMarketCommand(): Command {
  const market = new Command('market').description(
    'Market Index value signals, price movement, metadata trends, market overview, and named-lot evidence'
  );

  // market signals
  market
    .command('signals')
    .description('Actionable market value signals (public summary via --summary)')
    .option('--summary')
    .option('--type <type>', '', collectSignalTypes)
    .option('--origin <origin>')
    .option('--process <method>')
    .option('--market <retail|wholesale|all>')
    .option('--min-discount <n>')
    .option('--min-score <n>')
    .option('--window <7d|30d>')
    .option('--limit <n>')
    .addHelpText(
      'after',
      `
Examples:
  purvey market signals --summary --pretty
  purvey market signals --type price_drop --type below_market --origin "Ethiopia" --json
  purvey market signals --market wholesale --min-discount 10 --window 7d --json

Notes:
  --summary is the only unauthenticated slice; any filter requires Parchment Intelligence access.
  Related: 'purvey market stats' (movement significance), 'purvey price-index' (aggregate snapshots).
  Set PARCHMENT_API_KEY or PURVEYORS_API_KEY to use an API key instead of the logged-in session.`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const query: MarketSignalsQuery = {};
        if (opts.summary === true) query.summary = 'true';
        const types = (opts.type as string[] | undefined) ?? [];
        if (types.length > 0) query.type = types;
        if (opts.origin !== undefined) query.origin = opts.origin as string;
        if (opts.process !== undefined) query.process = opts.process as string;
        if (opts.market !== undefined)
          query.market = parseEnum(opts.market as string, '--market', MARKETS);
        if (opts.minDiscount !== undefined)
          query.min_discount_pct = parseNumber(opts.minDiscount as string, '--min-discount');
        if (opts.minScore !== undefined)
          query.min_score = parseNumber(opts.minScore as string, '--min-score');
        if (opts.window !== undefined)
          query.window = parseEnum(opts.window as string, '--window', WINDOWS);
        if (opts.limit !== undefined)
          query.limit = parsePositiveInt(
            opts.limit as string,
            '--limit',
            CLI_NUMERIC_BOUNDS.marketSignalsLimit.maximum
          );

        const client = await createOptionalParchmentClient();
        const data = unwrapParchment(await client.market.signals(query), 'market signals');
        outputData(data, globalOpts);
      })
    );

  // market stats
  market
    .command('stats')
    .description('Price movement-significance stats (public retail summary works unauthenticated)')
    .option('--origin <origin>')
    .option('--process <method>')
    .option('--market <retail|wholesale|all>')
    .option('--window <7d|30d>')
    .option('--baseline-weeks <n>')
    .addHelpText(
      'after',
      `
Examples:
  purvey market stats --pretty
  purvey market stats --origin "Colombia" --window 30d --json
  purvey market stats --market wholesale --baseline-weeks 12 --json

Notes:
  The unfiltered retail slice is public; origin/process/wholesale filters require Intelligence access.
  Related: 'purvey price-index' (aggregate price snapshots the moves are derived from).`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const query: PriceIndexStatsQuery = {};
        if (opts.origin !== undefined) query.origin = opts.origin as string;
        if (opts.process !== undefined) query.process = opts.process as string;
        if (opts.market !== undefined)
          query.market = parseEnum(opts.market as string, '--market', MARKETS);
        if (opts.window !== undefined)
          query.window = parseEnum(opts.window as string, '--window', WINDOWS);
        if (opts.baselineWeeks !== undefined)
          query.baseline_weeks = parseIntRange(
            opts.baselineWeeks as string,
            '--baseline-weeks',
            8,
            52
          );

        const client = await createOptionalParchmentClient();
        const data = unwrapParchment(await client.priceIndex.stats(query), 'market stats');
        outputData(data, globalOpts);
      })
    );

  // market metadata
  market
    .command('metadata')
    .description('Metadata-trend index (public process/retail/month slice works unauthenticated)')
    .option('--dimension <process|disclosure|score>')
    .option('--origin <origin>')
    .option('--market <retail|wholesale|all>')
    .option('--grain <week|month>')
    .option('--from <date>')
    .option('--to <date>')
    .addHelpText(
      'after',
      `
Examples:
  purvey market metadata --pretty
  purvey market metadata --dimension score --origin "Ethiopia" --grain month --json
  purvey market metadata --dimension disclosure --from 2026-04-01 --to 2026-07-01 --json

Notes:
  Public slice is dimension=process, no origin, market=retail, grain=month; anything else requires Intelligence access.
  Cultivar and drying dimensions are not available yet.`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const query: MetadataIndexQuery = {};
        if (opts.dimension !== undefined) {
          const dimension = parseEnum(opts.dimension as string, '--dimension', DIMENSIONS);
          query.dimension = dimension === 'score' ? 'purveyor_score' : dimension;
        }
        if (opts.origin !== undefined) query.origin = opts.origin as string;
        if (opts.market !== undefined)
          query.market = parseEnum(opts.market as string, '--market', MARKETS);
        if (opts.grain !== undefined)
          query.grain = parseEnum(opts.grain as string, '--grain', GRAINS);
        if (opts.from !== undefined) query.from = parseIsoDate(opts.from as string, '--from');
        if (opts.to !== undefined) query.to = parseIsoDate(opts.to as string, '--to');

        const client = await createOptionalParchmentClient();
        const data = unwrapParchment(await client.market.metadataIndex(query), 'market metadata');
        outputData(data, globalOpts);
      })
    );

  // market overview
  market
    .command('overview')
    .description('Aggregate green-coffee market overview (any signed-in session or API key)')
    .addHelpText(
      'after',
      `
Examples:
  purvey market overview --pretty
  purvey market overview --json

Notes:
  Aggregate-only daily change, live catalog coverage, movement velocity, processing mix,
  and origin price distributions. The API rejects anonymous requests; any signed-in
  session or API key with catalog read access receives the same public evidence.
  Related: 'purvey market evidence' (named lots and supplier evidence).`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const client = await createParchmentClient('viewer');
        const data = unwrapParchment(await client.market.overview(), 'market overview');
        outputData(data, globalOpts);
      })
    );

  // market evidence
  market
    .command('evidence')
    .description('Named arrivals, delistings, comparable lots, and supplier evidence (entitled)')
    .addHelpText(
      'after',
      `
Examples:
  purvey market evidence --pretty
  purvey market evidence --json

Notes:
  Requires Parchment Intelligence plus catalog read access, enforced by the API.
  Related: 'purvey market overview' (aggregate-only public evidence).`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const client = await createParchmentClient('member');
        const data = unwrapParchment(await client.market.evidence(), 'market evidence');
        outputData(data, globalOpts);
      })
    );

  return market;
}
