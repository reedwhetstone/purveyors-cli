import { Command } from 'commander';
import type { PriceIndexQuery } from '@purveyors/sdk';
import { outputData } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { createParchmentClient, unwrapParchment } from '../lib/parchment.js';
import { parseStrictPositiveCount } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

function parsePositiveInt(rawValue: string, flag: string): number {
  const parsed = parseStrictPositiveCount(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${rawValue}". Must be a positive integer.`
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

/**
 * `purvey price-index` — Parchment Price Index aggregate snapshots.
 * Requires an authenticated session or API key with price-index entitlement.
 */
export function buildPriceIndexCommand(): Command {
  const priceIndex = new Command('price-index')
    .description('Fetch Parchment Price Index aggregate snapshots (requires price-index access)')
    .option('--origin <origin>', 'Filter by origin')
    .option('--process <method>', 'Filter by process method')
    .option('--grade <grade>', 'Filter by grade')
    .option('--from <date>', 'Include snapshots on/after this ISO date (YYYY-MM-DD)')
    .option('--to <date>', 'Include snapshots on/before this ISO date (YYYY-MM-DD)')
    .option('--wholesale <true|false>', 'Filter by wholesale pricing scope')
    .option('--page <n>', '1-based page number')
    .option('--limit <n>', 'Results per page')
    .addHelpText(
      'after',
      `
Examples:
  purvey price-index --pretty
  purvey price-index --origin "Ethiopia" --json
  purvey price-index --from 2026-01-01 --to 2026-06-30 --pretty
  purvey price-index --wholesale true --limit 25 --json

Notes:
  Requires a Purveyors session or API key with price-index (PPI) access.
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
          query.limit = parsePositiveInt(opts.limit as string, '--limit');

        const client = await createParchmentClient('member');
        const result = await client.priceIndex.list(query);
        const data = unwrapParchment(result, 'price-index');
        outputData(data, globalOpts);
      })
    );

  return priceIndex;
}
