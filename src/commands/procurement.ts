import { Command } from 'commander';
import type { BriefMatchesQuery } from '@purveyors/sdk';
import { outputData } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { createParchmentClient, unwrapParchment } from '../lib/parchment.js';
import { parseStrictPositiveCount } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

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

/**
 * `purvey procurement` — read saved sourcing briefs from the canonical API.
 * Brief creation is a write and is handled by the Phase 2 write build-out
 * (PADR-0016), not by this read surface.
 */
export function buildProcurementCommand(): Command {
  const procurement = new Command('procurement').description(
    'Read saved sourcing briefs and their catalog matches'
  );

  // procurement list
  procurement
    .command('list')
    .description('List your saved sourcing briefs')
    .addHelpText(
      'after',
      `
Examples:
  purvey procurement list --pretty
  purvey procurement list --json | jq '.data'`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const client = await createParchmentClient('member');
        const result = await client.procurement.briefs.list();
        const data = unwrapParchment(result, 'procurement list');
        outputData(data, globalOpts);
      })
    );

  // procurement get <id>
  procurement
    .command('get <id>')
    .description('Get a single saved sourcing brief by id')
    .addHelpText(
      'after',
      `
Examples:
  purvey procurement get 3f9a2c10-... --pretty`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const client = await createParchmentClient('member');
        const result = await client.procurement.briefs.get(id);
        const data = unwrapParchment(result, 'procurement get');
        outputData(data, globalOpts);
      })
    );

  // procurement matches <id>
  procurement
    .command('matches <id>')
    .description('Run a saved brief against the catalog and page through matches')
    .option('--page <n>', '1-based page number (default 1)')
    .option('--limit <n>', 'Matches per page (max 100; default 25)')
    .addHelpText(
      'after',
      `
Examples:
  purvey procurement matches 3f9a2c10-... --pretty
  purvey procurement matches 3f9a2c10-... --page 2 --limit 50 --json`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const query: BriefMatchesQuery = {};
        if (opts.page !== undefined) query.page = parsePositiveInt(opts.page as string, '--page');
        if (opts.limit !== undefined)
          query.limit = parsePositiveInt(opts.limit as string, '--limit', 100);

        const client = await createParchmentClient('member');
        const result = await client.procurement.briefs.matches(id, query);
        const data = unwrapParchment(result, 'procurement matches');
        outputData(data, globalOpts);
      })
    );

  return procurement;
}
