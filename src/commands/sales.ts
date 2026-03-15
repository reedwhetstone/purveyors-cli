import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import type { OutputOptions } from '../types/index.js';

// ─── Local types ──────────────────────────────────────────────────────────────

export interface Sale {
  id: number;
  roast_id: number | null;
  oz_sold: number | null;
  sale_price: number | null;
  buyer: string | null;
  sell_date: string | null;
  user: string;
  last_updated: string;
}

// ─── Shared select columns ────────────────────────────────────────────────────

const SALE_SELECT = 'id, roast_id, oz_sold, sale_price, buyer, sell_date, user, last_updated';

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `prvrs sales` — Record and manage coffee sales.
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
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
        }

        const limit = Math.max(1, parseInt(opts.limit as string, 10));

        // Join with roast_profiles to surface coffee name
        const { data, error } = await supabase
          .from('sales')
          .select(`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)`)
          .eq('user', user.id)
          .order('sell_date', { ascending: false })
          .limit(limit);

        if (error) throw error;

        if (!data || data.length === 0) {
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
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
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

        // Verify the roast profile belongs to the user
        const { data: roastExists, error: roastError } = await supabase
          .from('roast_profiles')
          .select('roast_id')
          .eq('roast_id', roastId)
          .eq('user', user.id)
          .single();

        if (roastError || !roastExists) {
          throw new AuthError(`Roast profile ${roastId} not found or does not belong to you.`);
        }

        const insertPayload: Record<string, unknown> = {
          user: user.id,
          roast_id: roastId,
          oz_sold: oz,
          sale_price: price,
          sell_date: (opts.sellDate as string | undefined) ?? todayIso(),
        };

        if (opts.buyer !== undefined) {
          insertPayload.buyer = opts.buyer;
        }

        const { data: inserted, error: insertError } = await supabase
          .from('sales')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertError) throw insertError;

        // Re-fetch the full row with roast join
        const { data, error } = await supabase
          .from('sales')
          .select(`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)`)
          .eq('id', inserted.id)
          .single();

        if (error) throw error;

        success(`Sale ${inserted.id} recorded.`);
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
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
        }

        const saleId = parseInt(id, 10);
        if (isNaN(saleId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid sale ID: "${id}".`);
        }

        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from('sales')
          .select('id')
          .eq('id', saleId)
          .eq('user', user.id)
          .single();

        if (fetchError || !existing) {
          throw new AuthError(`Sale ${id} not found or does not belong to you.`);
        }

        // Build partial update
        const updates: Record<string, unknown> = {};

        if (opts.oz !== undefined) {
          const oz = parseFloat(opts.oz as string);
          if (isNaN(oz) || oz <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz: "${opts.oz}".`);
          updates.oz_sold = oz;
        }

        if (opts.price !== undefined) {
          const price = parseFloat(opts.price as string);
          if (isNaN(price) || price < 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --price: "${opts.price}".`);
          updates.sale_price = price;
        }

        if (opts.buyer !== undefined) {
          updates.buyer = opts.buyer;
        }

        if (opts.sellDate !== undefined) {
          updates.sell_date = opts.sellDate;
        }

        if (Object.keys(updates).length === 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --oz, --price, --buyer, --sell-date.'
          );
        }

        const { error: updateError } = await supabase
          .from('sales')
          .update(updates)
          .eq('id', saleId)
          .eq('user', user.id);

        if (updateError) throw updateError;

        // Re-fetch the updated row
        const { data, error } = await supabase
          .from('sales')
          .select(`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)`)
          .eq('id', saleId)
          .single();

        if (error) throw error;

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
        void cmd; // global opts not needed for delete
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
        }

        const saleId = parseInt(id, 10);
        if (isNaN(saleId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid sale ID: "${id}".`);
        }

        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from('sales')
          .select('id, sell_date, oz_sold')
          .eq('id', saleId)
          .eq('user', user.id)
          .single();

        if (fetchError || !existing) {
          throw new AuthError(`Sale ${id} not found or does not belong to you.`);
        }

        if (!opts.yes) {
          const label = existing.sell_date
            ? `from ${existing.sell_date} (${existing.oz_sold} oz)`
            : `#${saleId}`;
          const ok = await confirm(`Delete sale ${label}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const { error: deleteError } = await supabase
          .from('sales')
          .delete()
          .eq('id', saleId)
          .eq('user', user.id);

        if (deleteError) throw deleteError;

        success(`Sale ${saleId} deleted.`);
      })
    );

  return sales;
}
