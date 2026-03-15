import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listSales, recordSale, updateSale, deleteSale } from '../lib/sales.js';
import type { Sale } from '../lib/sales.js';
import type { OutputOptions } from '../types/index.js';

// Re-export type for backwards compatibility
export type { Sale };

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey sales` — Record and manage coffee sales.
 * Requires authentication.
 */
export function buildSalesCommand(): Command {
  const sales = new Command('sales').description('Record and manage coffee sales');

  // ── sales list ────────────────────────────────────────────────────────────
  sales
    .command('list')
    .description('List your sales, sorted by sell date (newest first)')
    .option('--limit <n>', 'Maximum results to return', '20')
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        const data = await listSales(supabase, user.id, {
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
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
    .requiredOption('--roast-id <id>', 'Roast profile ID')
    .requiredOption('--oz <amount>', 'Ounces sold')
    .requiredOption('--price <dollars>', 'Sale price in dollars')
    .option('--buyer <name>', 'Buyer name or identifier')
    .option('--sell-date <YYYY-MM-DD>', 'Sale date (defaults to today)')
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        const roastId = parseInt(opts.roastId as string, 10);
        if (isNaN(roastId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --roast-id: "${opts.roastId}".`);
        }

        const oz = parseFloat(opts.oz as string);
        if (isNaN(oz) || oz <= 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --oz: "${opts.oz}". Must be a positive number.`
          );
        }

        const price = parseFloat(opts.price as string);
        if (isNaN(price) || price < 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --price: "${opts.price}". Must be a non-negative number.`
          );
        }

        const data = await recordSale(supabase, user.id, {
          roastId,
          oz,
          price,
          buyer: opts.buyer as string | undefined,
          sellDate: (opts.sellDate as string | undefined) ?? todayIso(),
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
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

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

        const data = await updateSale(supabase, user.id, saleId, {
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
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

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

        await deleteSale(supabase, user.id, saleId);
        success(`Sale ${saleId} deleted.`);
      })
    );

  return sales;
}
