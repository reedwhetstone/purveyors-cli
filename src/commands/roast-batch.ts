import { Command } from 'commander';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { confirm, localDateIso } from '../lib/prompts.js';
import {
  listRoastBatches,
  getRoastBatch,
  createRoastBatch,
  updateRoastBatch,
  deleteRoastBatch,
  parseRoastBatchId,
  ROAST_BATCH_LIST_LIMIT,
} from '../lib/roast.js';
import { parseStrictOffset, parseStrictPositiveCount } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseBatchDate(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const text = String(value);
  if (!DATE_PATTERN.test(text)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${text}". Must be YYYY-MM-DD format.`
    );
  }
  return text;
}

function parseBatchListLimit(value: string): number {
  const parsed = parseStrictPositiveCount(value);
  const { minimum, maximum } = ROAST_BATCH_LIST_LIMIT;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid --limit: "${value}". Must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return parsed;
}

function parseBatchListOffset(value: string): number {
  const parsed = parseStrictOffset(value);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid --offset: "${value}". Must be a non-negative integer.`
    );
  }
  return parsed;
}

/**
 * `purvey roast-batch` — List and manage roast batches by batch ID.
 * Requires member+ authentication.
 */
export function buildRoastBatchCommand(): Command {
  const roastBatch = new Command('roast-batch').description(
    'List, open, rename, and delete roast batches by batch ID'
  );

  // ── roast-batch list ──────────────────────────────────────────────────────
  roastBatch
    .command('list')
    .description('List your roast batches, newest batch date first')
    .option('--name <name>')
    .option('--date-start <YYYY-MM-DD>')
    .option('--date-end <YYYY-MM-DD>')
    .option('--include-empty')
    .option('--limit <n>', '', '20')
    .option('--offset <n>', '', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast-batch list --pretty
  purvey roast-batch list --name "wednesday" --pretty
  purvey roast-batch list --date-start 2026-10-01 --date-end 2026-10-31
  purvey roast-batch list --include-empty --pretty
  purvey roast-batch list --limit 50 | jq '.[] | {id, name, batch_date, roast_ids}'
  purvey roast-batch list --include-empty --limit 200 | jq '.[] | select(.roast_count == 0) | .id'
  purvey roast-batch list --csv > batches.csv

Notes:
  A batch is one roasting session. Batch names can repeat, so every batch has its own ID.
  --name matches the whole name exactly and returns every batch that carries it.
  --date-start and --date-end filter on the batch date, not on the roast dates inside it.
  Batches with no roasts are left out unless you pass --include-empty.
  Each batch lists roast_ids (its roasts) and coffee_ids (the inventory items roasted).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await listRoastBatches({
          name: opts.name as string | undefined,
          dateStart: parseBatchDate(opts.dateStart, '--date-start'),
          dateEnd: parseBatchDate(opts.dateEnd, '--date-end'),
          includeEmpty: opts.includeEmpty === true ? true : undefined,
          limit: parseBatchListLimit(opts.limit as string),
          offset: parseBatchListOffset(opts.offset as string),
        });

        if (data.length === 0) {
          info('No roast batches found.');
          return;
        }

        outputData(data, globalOpts);
      })
    );

  // ── roast-batch get <id> ──────────────────────────────────────────────────
  roastBatch
    .command('get <id>')
    .description('Fetch one roast batch with the IDs of its roasts')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast-batch get 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --pretty
  purvey roast-batch get 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e | jq '.roast_ids'

Notes:
  <id> is the batch ID (UUID) from 'purvey roast-batch list' or the batch_id on a roast.
  List the full roasts with 'purvey roast list --batch-id <id>'.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await getRoastBatch(parseRoastBatchId(id, 'batch ID'));
        outputData(data, globalOpts);
      })
    );

  // ── roast-batch create ────────────────────────────────────────────────────
  roastBatch
    .command('create')
    .description('Open a new, empty roast batch to add roasts to')
    .requiredOption('--name <name>')
    .option('--date <YYYY-MM-DD>')
    .option('--idempotency-key <key>')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast-batch create --name "wednesday" --pretty
  purvey roast-batch create --name "wednesday" --date 2026-10-07 | jq -r '.id'

Notes:
  Always opens a new batch, even when another batch already has the same name.
  Add roasts with --batch-id on 'purvey roast import', 'purvey roast create', or
  'purvey roast from-reference'.
  --date is the session date and defaults to today. Roasts keep their own roast dates, so a
  batch can hold roasts from more than one day.
  Until it holds a roast, the batch is listed only with --include-empty and shows a
  placeholder name; the name you gave appears once the first roast is added.
  'purvey roast watch' opens its own batch, so this is for importing files one at a time.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await createRoastBatch(
          {
            name: String(opts.name),
            batchDate: parseBatchDate(opts.date, '--date') ?? localDateIso(),
          },
          { idempotencyKey: opts.idempotencyKey ? String(opts.idempotencyKey) : undefined }
        );

        success(`Roast batch ${data.id} opened.`);
        outputData(data, globalOpts);
      })
    );

  // ── roast-batch update <id> ───────────────────────────────────────────────
  roastBatch
    .command('update <id>')
    .description('Rename or re-date a roast batch')
    .option('--name <name>')
    .option('--date <YYYY-MM-DD>')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast-batch update 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --name "wednesday decaf"
  purvey roast-batch update 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --date 2026-10-07

Notes:
  At least one flag required.
  --name renames this batch only. The new name also appears on its roasts and on the sales
  recorded against it. Other batches with the old name are not changed.
  --date changes the batch date. Roast dates are not changed.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const batchId = parseRoastBatchId(id, 'batch ID');
        const name = opts.name as string | undefined;
        const batchDate = parseBatchDate(opts.date, '--date');

        if (name === undefined && batchDate === undefined) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --name, --date.'
          );
        }

        const data = await updateRoastBatch(batchId, { name, batchDate });

        success(`Roast batch ${batchId} updated.`);
        outputData(data, globalOpts);
      })
    );

  // ── roast-batch delete <id> ───────────────────────────────────────────────
  roastBatch
    .command('delete <id>')
    .description('Delete one roast batch and the roasts in it')
    .option('-y, --yes')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast-batch delete 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e         # prompts for confirmation
  purvey roast-batch delete 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --yes   # skip confirmation (use in scripts)

Notes:
  Permanently deletes this batch and every roast in it, with their temperature and event data.
  No other batch is touched, even one with the same name.
  Sales recorded against the batch are kept. They keep the batch name and lose the link to it.
  Prints the deleted batch ID, its name, and the IDs of the roasts deleted with it.
  Cannot be undone. Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const batchId = parseRoastBatchId(id, 'batch ID');

        if (!opts.yes) {
          const batch = await getRoastBatch(batchId);
          const roasts =
            batch.roast_count === 0
              ? 'It holds no roasts.'
              : `Its ${batch.roast_count} roast${batch.roast_count !== 1 ? 's' : ''} will be deleted too.`;
          const ok = await confirm(
            `Delete roast batch "${batch.name}" (${batch.batch_date})? ${roasts}`
          );
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const data = await deleteRoastBatch(batchId);
        success(
          `Roast batch ${batchId} deleted with ${data.ids.length} roast${data.ids.length !== 1 ? 's' : ''}.`
        );
        outputData(data, globalOpts);
      })
    );

  return roastBatch;
}
