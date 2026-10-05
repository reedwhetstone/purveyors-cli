import { Command } from 'commander';
import * as p from '@clack/prompts';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError, AuthError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listSales, recordSale, updateSale, deleteSale } from '../lib/sales.js';
import type { Sale, RecordSaleInput } from '../lib/sales.js';
import { parseRoastBatchId } from '../lib/roast.js';
import { pickRoast, guardCancel } from '../lib/interactive/forms.js';
import { getConfigValue } from '../lib/config.js';
import {
  parseStrictFiniteNumber,
  parseStrictInt4Id,
  parseStrictOffset,
  parseStrictPositiveCount,
} from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

// Re-export type for backwards compatibility
export type { Sale };

type SalesRecordOptions = {
  roastId?: string;
  coffeeId?: string;
  batchId?: string;
  batchName?: string;
  oz?: string;
  price?: string;
  buyer?: string;
  sellDate?: string;
  form?: boolean;
};

type SessionSource = {
  getSession(): Promise<{ data: { session: { apiKey: string } | null } }>;
};

/** Keep selection credential-scoped, then refresh and pin the identity at the write boundary. */
export async function recordInteractiveSale(
  sessionSource: SessionSource,
  input: Omit<RecordSaleInput, 'roastId' | 'coffeeId' | 'batchId' | 'batchName'>,
  selectRoast: (token: string) => Promise<{ id: number; batchName: string }> = pickRoast,
  onWriteStart: () => void = () => undefined
): Promise<Sale> {
  const {
    data: { session: selectionSession },
  } = await sessionSource.getSession();
  if (!selectionSession?.apiKey) {
    throw new AuthError('Session expired mid-form. Run `purvey auth login` and retry.');
  }
  const roast = await selectRoast(selectionSession.apiKey);

  const {
    data: { session: writeSession },
  } = await sessionSource.getSession();
  if (!writeSession?.apiKey) {
    throw new AuthError('Session expired mid-form. Run `purvey auth login` and retry.');
  }
  onWriteStart();
  return recordSale({ roastId: roast.id, ...input }, writeSession.apiKey);
}

function parsePositiveIntegerOption(flag: string, value: string): number {
  const parsed = parseStrictInt4Id(value);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be an integer between 1 and 2147483647.`
    );
  }
  return parsed;
}

function parseSalesListCount(value: string, flag: '--limit' | '--offset'): number {
  const parsed = flag === '--offset' ? parseStrictOffset(value) : parseStrictPositiveCount(value);
  if (!Number.isFinite(parsed)) {
    const requirement = flag === '--offset' ? 'a non-negative integer' : 'a positive integer';
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be ${requirement}.`
    );
  }
  return parsed;
}

function parsePositiveNumberOption(flag: string, value: string): number {
  const parsed = parseStrictFiniteNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a positive number.`
    );
  }
  return parsed;
}

function parseNonNegativeNumberOption(flag: string, value: string): number {
  const parsed = parseStrictFiniteNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a non-negative number.`
    );
  }
  return parsed;
}

function hasCompleteRecordSaleFlagInput(opts: SalesRecordOptions): boolean {
  const hasResolvedSelector = opts.coffeeId !== undefined && Boolean(opts.batchName?.trim());
  const hasSelector =
    opts.roastId !== undefined || opts.batchId !== undefined || hasResolvedSelector;

  return hasSelector && opts.oz !== undefined && opts.price !== undefined;
}

function parseRecordSaleFlagInput(opts: SalesRecordOptions): RecordSaleInput {
  if (!opts.oz) {
    throw new PrvrsError('INVALID_ARGUMENT', 'Missing --oz. Use --form for interactive mode.');
  }
  if (opts.price === undefined) {
    throw new PrvrsError('INVALID_ARGUMENT', 'Missing --price. Use --form for interactive mode.');
  }

  const hasRoastId = opts.roastId !== undefined;
  const hasCoffeeId = opts.coffeeId !== undefined;
  const hasBatchId = opts.batchId !== undefined;
  const rawBatchName = opts.batchName?.trim();
  const hasBatchName = Boolean(rawBatchName);

  if (hasBatchId && opts.batchName !== undefined) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Use either --batch-id or --batch-name, not both. A batch ID already identifies one batch.'
    );
  }

  if (hasRoastId && (hasCoffeeId || opts.batchName !== undefined)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Use either --roast-id or --coffee-id + --batch-name, not both.'
    );
  }

  if (!hasRoastId && !hasBatchId && !hasCoffeeId && opts.batchName === undefined) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Missing sale target. Pass --batch-id, --roast-id, or both --coffee-id and --batch-name. Use --form for interactive mode.'
    );
  }

  if (!hasRoastId && !hasBatchId && hasCoffeeId && !hasBatchName) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Missing --batch-id or --batch-name. With --coffee-id, say which batch was sold.'
    );
  }

  if (!hasRoastId && !hasBatchId && !hasCoffeeId && opts.batchName !== undefined) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Missing --coffee-id. Resolved mode requires both --coffee-id and --batch-name.'
    );
  }

  const input: RecordSaleInput = {
    oz: parsePositiveNumberOption('--oz', opts.oz),
    price: parseNonNegativeNumberOption('--price', opts.price),
    buyer: opts.buyer,
    sellDate: opts.sellDate,
  };

  if (hasBatchId) {
    input.batchId = parseRoastBatchId(opts.batchId!, '--batch-id');
  }
  if (hasRoastId) {
    input.roastId = parsePositiveIntegerOption('--roast-id', opts.roastId!);
  } else if (hasCoffeeId) {
    input.coffeeId = parsePositiveIntegerOption('--coffee-id', opts.coffeeId!);
  }
  if (!hasRoastId && !hasBatchId) {
    input.batchName = rawBatchName!;
  }

  return input;
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey sales` — Record and manage coffee sales.
 * Requires member+ authentication.
 */
export function buildSalesCommand(): Command {
  const sales = new Command('sales').description('Record and manage coffee sales');

  // ── sales list ────────────────────────────────────────────────────────────
  sales
    .command('list')
    .description('List your sales, sorted by sell date (newest first)')
    .option('--coffee-id <id>')
    .option('--batch-id <uuid>')
    .option('--roast-id <id>')
    .option('--date-start <YYYY-MM-DD>')
    .option('--date-end <YYYY-MM-DD>')
    .option('--buyer <name>')
    .option('--limit <n>', '', '20')
    .option('--offset <n>', '', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales list --pretty
  purvey sales list --coffee-id 42 --pretty
  purvey sales list --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --pretty
  purvey sales list --date-start 2026-03-01 --date-end 2026-03-31 --pretty
  purvey sales list --buyer "Jane" --pretty
  purvey sales list --date-start 2026-01-01 --limit 100 --csv > sales-ytd.csv
  purvey sales list --limit 50 | jq '.[].id'
  purvey sales list --limit 20 --offset 20   # page 2

Notes:
  Returns sale records with green_coffee_inv_id, batch_id, roast_id, batch_name, oz_sold, price,
  buyer, and sell_date. batch_id is null on a sale that is not linked to one batch.
  --coffee-id filters by inventory ID.
  --batch-id returns the sales recorded against one batch; --roast-id the sales that name one roast.
  --date-start and --date-end accept YYYY-MM-DD; use together for a date range.
  --buyer accepts partial matches (case-insensitive).
  --offset + --limit enables pagination through large result sets.
  All filters are optional and composable.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        let greenCoffeeInvId: number | undefined;
        if (opts.coffeeId !== undefined) {
          greenCoffeeInvId = parsePositiveIntegerOption('--coffee-id', opts.coffeeId as string);
        }

        const data = await listSales({
          limit: parseSalesListCount(opts.limit as string, '--limit'),
          offset: parseSalesListCount(opts.offset as string, '--offset'),
          greenCoffeeInvId,
          batchId:
            opts.batchId !== undefined
              ? parseRoastBatchId(String(opts.batchId), '--batch-id')
              : undefined,
          roastId:
            opts.roastId !== undefined
              ? parsePositiveIntegerOption('--roast-id', opts.roastId as string)
              : undefined,
          dateStart: opts.dateStart as string | undefined,
          dateEnd: opts.dateEnd as string | undefined,
          buyer: opts.buyer as string | undefined,
        });

        if (data.length === 0) {
          info('No sales found.');
          return;
        }

        outputData(data, globalOpts);
      })
    );

  // ── sales record ──────────────────────────────────────────────────────────
  sales
    .command('record')
    .description('Record a new sale')
    .option('--batch-id <uuid>')
    .option('--roast-id <id>')
    .option('--coffee-id <id>')
    .option('--batch-name <name>')
    .option('--oz <amount>')
    .option('--price <dollars>')
    .option('--buyer <name>')
    // NOTE: --notes omitted; sales table has no notes column yet. See phase3 plan doc.
    .option('--sell-date <YYYY-MM-DD>')
    .option('--form')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales record --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --oz 12 --price 22.00 --pretty
  purvey sales record --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --coffee-id 7 --oz 8 --price 16.00
  purvey sales record --roast-id 123 --oz 12 --price 22.00
  purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 16 --price 28.00 --sell-date 2026-03-10
  purvey sales record --form     # interactive wizard (browse roasts)

Selector modes:
  Batch:    --batch-id <uuid> [--coffee-id <id>]
  Roast:    --roast-id <id> [--batch-id <uuid>]
  By name:  --coffee-id <id> --batch-name <name>

  Batch records the sale against one batch as a whole. Use it when the bag could have come from
  any of the batch's roasts of that coffee. --coffee-id is needed only when the batch holds
  roasts of more than one inventory item.
  Roast records the sale against that one roast and its batch. Use it when you know the roast,
  for example when one batch roasted the same coffee to two levels.
  By name finds your batch with that exact name that holds a roast of --coffee-id. Batch names
  can repeat: when the name matches more than one batch, nothing is recorded and the error lists
  each batch ID with its date and roasts, so you can run the command again with --batch-id.

Required flags: selector mode, --oz, --price
  Use 'purvey roast-batch list' to find a --batch-id, or 'purvey roast list' for a --roast-id.
  The recorded sale includes batch_id, and roast_id when you named a roast.
  --price is the total sale price (not per-oz).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: SalesRecordOptions, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const formMode =
          opts.form ||
          (!hasCompleteRecordSaleFlagInput(opts) && (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
          const { credentialContext } = await requireAuth('member');
          p.intro('Record Sale');

          const ozRaw = await p.text({
            message: 'Ounces sold',
            placeholder: '12',
            validate: (v) => {
              const n = parseStrictFiniteNumber(String(v));
              if (!Number.isFinite(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(ozRaw);

          const priceRaw = await p.text({
            message: 'Sale price ($)',
            placeholder: '22.00',
            validate: (v) => {
              const n = parseStrictFiniteNumber(String(v));
              if (!Number.isFinite(n) || n < 0) return 'Must be a non-negative number.';
            },
          });
          guardCancel(priceRaw);

          const buyerRaw = await p.text({
            message: 'Buyer',
            placeholder: 'optional',
          });
          guardCancel(buyerRaw);

          const confirmed = await p.confirm({ message: 'Record this sale?' });
          guardCancel(confirmed);

          if (!confirmed) {
            p.cancel('Aborted.');
            return;
          }

          const buyerStr = String(buyerRaw).trim();

          const spin = p.spinner();
          const data = await recordInteractiveSale(
            credentialContext,
            {
              oz: parseStrictFiniteNumber(String(ozRaw)),
              price: parseStrictFiniteNumber(String(priceRaw)),
              buyer: buyerStr !== '' ? buyerStr : undefined,
              sellDate: todayIso(),
            },
            pickRoast,
            () => spin.start('Recording sale...')
          );
          spin.stop('Done');

          p.outro(`Sale recorded! Sale #${data.id}.`);
          outputData(data, globalOpts);
          return;
        }

        const recordInput = parseRecordSaleFlagInput(opts);
        const data = await recordSale({
          ...recordInput,
          sellDate: recordInput.sellDate ?? todayIso(),
        });

        success(`Sale ${data.id} recorded.`);
        outputData(data, globalOpts);
      })
    );

  // ── sales update <id> ─────────────────────────────────────────────────────
  sales
    .command('update <id>')
    .description('Update an existing sale (must be yours)')
    .option('--oz <amount>')
    .option('--price <dollars>')
    .option('--buyer <name>')
    .option('--sell-date <YYYY-MM-DD>')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales update 5 --price 24.00
  purvey sales update 5 --oz 10 --price 18.00
  purvey sales update 5 --buyer "Coffee Shop A" --sell-date 2026-03-12

Notes:
  At least one flag required. Pass only the fields you want to change.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const saleId = parsePositiveIntegerOption('sale ID', id);

        let oz: number | undefined;
        if (opts.oz !== undefined) {
          oz = parseStrictFiniteNumber(opts.oz as string);
          if (!Number.isFinite(oz) || oz <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz: "${opts.oz}".`);
        }

        let price: number | undefined;
        if (opts.price !== undefined) {
          price = parseStrictFiniteNumber(opts.price as string);
          if (!Number.isFinite(price) || price < 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --price: "${opts.price}".`);
        }

        if (
          oz === undefined &&
          price === undefined &&
          opts.buyer === undefined &&
          opts.sellDate === undefined
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --oz, --price, --buyer, --sell-date.'
          );
        }

        const data = await updateSale(saleId, {
          oz,
          price,
          buyer: opts.buyer as string | undefined,
          sellDate: opts.sellDate as string | undefined,
        });

        success(`Sale ${saleId} updated.`);
        outputData(data, globalOpts);
      })
    );

  // ── sales delete <id> ─────────────────────────────────────────────────────
  sales
    .command('delete <id>')
    .description('Delete a sale (must be yours)')
    .option('-y, --yes')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales delete 5           # prompts for confirmation
  purvey sales delete 5 --yes     # skip confirmation (use in scripts)

Notes:
  Permanently deletes the sale record. Cannot be undone.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const saleId = parsePositiveIntegerOption('sale ID', id);

        if (!opts.yes) {
          const ok = await confirm(`Delete sale #${saleId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        await deleteSale(saleId);
        success(`Sale ${saleId} deleted.`);
      })
    );

  return sales;
}
