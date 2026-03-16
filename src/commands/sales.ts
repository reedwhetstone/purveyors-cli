import { Command } from 'commander';
import * as p from '@clack/prompts';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listSales, recordSale, updateSale, deleteSale } from '../lib/sales.js';
import type { Sale } from '../lib/sales.js';
import { pickRoast, guardCancel } from '../lib/interactive/forms.js';
import { getConfigValue } from '../lib/config.js';
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
    .option('--roast-id <id>', 'Roast profile ID')
    .option('--oz <amount>', 'Ounces sold')
    .option('--price <dollars>', 'Sale price in dollars')
    .option('--buyer <name>', 'Buyer name or identifier')
    // NOTE: --notes omitted; sales table has no notes column yet. See phase3 plan doc.
    .option('--sell-date <YYYY-MM-DD>', 'Sale date (defaults to today)')
    .option('--form', 'Interactive form mode')
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

        // ── Interactive form mode ──────────────────────────────────────────
        // Auto-enter form mode if config form-mode is true and required args are missing
        const formMode =
          opts.form ||
          (!(opts.roastId && opts.oz && opts.price) &&
            (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
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
          const roast = await pickRoast(supabase, user.id);

          const spin = p.spinner();
          spin.start('Recording sale...');
          const data = await recordSale(supabase, user.id, {
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

        // ── Flag-based mode ────────────────────────────────────────────────
        if (!opts.roastId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --roast-id. Use --form for interactive mode.'
          );
        }
        if (!opts.oz) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --oz. Use --form for interactive mode.'
          );
        }
        if (opts.price === undefined) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --price. Use --form for interactive mode.'
          );
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
