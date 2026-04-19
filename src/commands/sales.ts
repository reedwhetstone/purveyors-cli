import { Command } from 'commander';
import * as p from '@clack/prompts';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listSales, recordSale, updateSale, deleteSale } from '../lib/sales.js';
import type { Sale, RecordSaleInput } from '../lib/sales.js';
import { pickRoast, guardCancel } from '../lib/interactive/forms.js';
import { getConfigValue } from '../lib/config.js';
import type { OutputOptions } from '../types/index.js';

// Re-export type for backwards compatibility
export type { Sale };

type SalesRecordOptions = {
  roastId?: string;
  coffeeId?: string;
  batchName?: string;
  oz?: string;
  price?: string;
  buyer?: string;
  sellDate?: string;
  form?: boolean;
};

function parsePositiveIntegerOption(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a positive integer.`
    );
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a positive integer.`
    );
  }
  return parsed;
}

function parsePositiveNumberOption(flag: string, value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed <= 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a positive number.`
    );
  }
  return parsed;
}

function parseNonNegativeNumberOption(flag: string, value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be a non-negative number.`
    );
  }
  return parsed;
}

function hasCompleteRecordSaleFlagInput(opts: SalesRecordOptions): boolean {
  const hasResolvedSelector = opts.coffeeId !== undefined && Boolean(opts.batchName?.trim());
  const hasSelector = opts.roastId !== undefined || hasResolvedSelector;

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
  const rawBatchName = opts.batchName?.trim();
  const hasBatchName = Boolean(rawBatchName);

  if (hasRoastId && (hasCoffeeId || opts.batchName !== undefined)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Use either --roast-id or --coffee-id + --batch-name, not both.'
    );
  }

  if (!hasRoastId && !hasCoffeeId && opts.batchName === undefined) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Missing sale target. Pass --roast-id or both --coffee-id and --batch-name. Use --form for interactive mode.'
    );
  }

  if (!hasRoastId && hasCoffeeId && !hasBatchName) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'Missing --batch-name. Resolved mode requires both --coffee-id and --batch-name.'
    );
  }

  if (!hasRoastId && !hasCoffeeId && opts.batchName !== undefined) {
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

  if (hasRoastId) {
    input.roastId = parsePositiveIntegerOption('--roast-id', opts.roastId!);
  } else {
    input.coffeeId = parsePositiveIntegerOption('--coffee-id', opts.coffeeId!);
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
    .option('--roast-id <id>', 'Filter by roast profile ID')
    .option('--date-start <YYYY-MM-DD>', 'Only show sales on or after this date')
    .option('--date-end <YYYY-MM-DD>', 'Only show sales on or before this date')
    .option('--buyer <name>', 'Filter by buyer name (partial match, case-insensitive)')
    .option('--limit <n>', 'Maximum results to return', '20')
    .option('--offset <n>', 'Skip N results (for pagination)', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales list --pretty
  purvey sales list --roast-id 42 --pretty
  purvey sales list --date-start 2026-03-01 --date-end 2026-03-31 --pretty
  purvey sales list --buyer "Jane" --pretty
  purvey sales list --date-start 2026-01-01 --limit 100 --csv > sales-ytd.csv
  purvey sales list --limit 50 | jq '.[].id'
  purvey sales list --limit 20 --offset 20   # page 2

Notes:
  Returns sale records with roast_id, oz, price, buyer, and sell_date.
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
        const { supabase, userId } = await requireAuth('member');

        let roastId: number | undefined;
        if (opts.roastId !== undefined) {
          roastId = parsePositiveIntegerOption('--roast-id', opts.roastId as string);
        }

        const offsetVal = parseInt(opts.offset as string, 10);
        const data = await listSales(supabase, userId, {
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
          offset: isNaN(offsetVal) || offsetVal < 0 ? 0 : offsetVal,
          roastId,
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
    .option('--roast-id <id>', 'Exact roast profile ID (roast_data.roast_id)')
    .option('--coffee-id <id>', 'Inventory item ID used for resolved selector mode')
    .option('--batch-name <name>', 'Batch name used with --coffee-id for resolved selector mode')
    .option('--oz <amount>', '[REQUIRED] Ounces sold')
    .option('--price <dollars>', '[REQUIRED] Sale price in dollars')
    .option('--buyer <name>', 'Buyer name or identifier (optional)')
    // NOTE: --notes omitted; sales table has no notes column yet. See phase3 plan doc.
    .option('--sell-date <YYYY-MM-DD>', 'Sale date (defaults to today)')
    .option('--form', 'Interactive form mode (browse and select roast)')
    .addHelpText(
      'after',
      `
Examples:
  purvey sales record --roast-id 123 --oz 12 --price 22.00 --pretty
  purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 8 --price 16.00
  purvey sales record --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz 16 --price 28.00 --sell-date 2026-03-10
  purvey sales record --form     # interactive wizard (browse roasts)

Selector modes:
  Exact:    --roast-id <id>
  Resolved: --coffee-id <id> --batch-name <name>
  Use exactly one selector mode.
  If multiple roasts match the same inventory item + batch name, re-run with --roast-id.

Required flags: selector mode, --oz, --price
  Use 'purvey roast list' to find your --roast-id.
  Use 'purvey roast list --coffee-id <id>' to inspect candidate roasts for resolved mode.
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
          const { supabase, userId } = await requireAuth('member');
          p.intro('Record Sale');

          const ozRaw = await p.text({
            message: 'Ounces sold',
            placeholder: '12',
            validate: (v) => {
              const n = parseFloat(String(v));
              if (isNaN(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(ozRaw);

          const priceRaw = await p.text({
            message: 'Sale price ($)',
            placeholder: '22.00',
            validate: (v) => {
              const n = parseFloat(String(v));
              if (isNaN(n) || n < 0) return 'Must be a non-negative number.';
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

          // Let user pick the specific roast batch to attribute this sale to.
          const roast = await pickRoast(supabase, userId);

          const spin = p.spinner();
          spin.start('Recording sale...');
          const data = await recordSale(supabase, userId, {
            roastId: roast.id,
            oz: parseFloat(String(ozRaw)),
            price: parseFloat(String(priceRaw)),
            buyer: buyerStr !== '' ? buyerStr : undefined,
            sellDate: todayIso(),
          });
          spin.stop('Done');

          p.outro(`Sale recorded! Sale #${data.id}.`);
          outputData(data, globalOpts);
          return;
        }

        const recordInput = parseRecordSaleFlagInput(opts);
        const { supabase, userId } = await requireAuth('member');

        const data = await recordSale(supabase, userId, {
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
    .option('--oz <amount>', 'Updated ounces sold')
    .option('--price <dollars>', 'Updated sale price')
    .option('--buyer <name>', 'Updated buyer name')
    .option('--sell-date <YYYY-MM-DD>', 'Updated sale date')
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
        const { supabase, userId } = await requireAuth('member');

        const saleId = parseInt(id, 10);
        if (isNaN(saleId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid sale ID: "${id}".`);
        }

        let oz: number | undefined;
        if (opts.oz !== undefined) {
          oz = parseFloat(opts.oz as string);
          if (isNaN(oz) || oz <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz: "${opts.oz}".`);
        }

        let price: number | undefined;
        if (opts.price !== undefined) {
          price = parseFloat(opts.price as string);
          if (isNaN(price) || price < 0)
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

        const data = await updateSale(supabase, userId, saleId, {
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
    .option('-y, --yes', 'Skip confirmation prompt')
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
        const { supabase, userId } = await requireAuth('member');

        const saleId = parseInt(id, 10);
        if (isNaN(saleId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid sale ID: "${id}".`);
        }

        if (!opts.yes) {
          const ok = await confirm(`Delete sale #${saleId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        await deleteSale(supabase, userId, saleId);
        success(`Sale ${saleId} deleted.`);
      })
    );

  return sales;
}
