import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, AuthError } from '../lib/errors.js';
import type { OutputOptions } from '../types/index.js';

// ─── Local types ──────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: number;
  rank: number | null;
  notes: string | null;
  cupping_notes: string | null;
  purchase_date: string | null;
  purchased_qty_lbs: number | null;
  bean_cost: number | null;
  tax_ship_cost: number | null;
  last_updated: string;
  user: string;
  catalog_id: number | null;
  stocked: boolean | null;
  coffee_catalog: {
    id: number;
    name: string | null;
    source: string | null;
    country: string | null;
    region: string | null;
    processing: string | null;
    cost_lb: number | null;
    description_short: string | null;
    stocked: boolean | null;
  } | null;
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `prvrs inventory` — Manage your green coffee inventory.
 * Requires authentication.
 */
export function buildInventoryCommand(): Command {
  const inventory = new Command('inventory').description('Manage your green coffee inventory');

  // ── inventory list ────────────────────────────────────────────────────────
  inventory
    .command('list')
    .description('List your green coffee inventory with catalog details')
    .option('--stocked', 'Only show currently stocked beans')
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

        const selectColumns = [
          'id',
          'rank',
          'notes',
          'cupping_notes',
          'purchase_date',
          'purchased_qty_lbs',
          'bean_cost',
          'tax_ship_cost',
          'last_updated',
          'user',
          'catalog_id',
          'stocked',
          'coffee_catalog!catalog_id (id, name, source, country, region, processing, cost_lb, description_short, stocked)',
        ].join(', ');

        let query = supabase.from('green_coffee_inv').select(selectColumns).eq('user', user.id);

        if (opts.stocked) {
          query = query.eq('stocked', true);
        }

        const limit = Math.max(1, parseInt(opts.limit as string, 10));
        const { data, error } = await query
          .order('last_updated', { ascending: false })
          .limit(limit);

        if (error) throw error;

        if (!data || data.length === 0) {
          info('No inventory items found.');
          return;
        }

        outputData(data, globalOpts);
      })
    );

  // ── inventory get <id> ────────────────────────────────────────────────────
  inventory
    .command('get <id>')
    .description('Fetch a single inventory item by ID (must be yours)')
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
        }

        const selectColumns = [
          'id',
          'rank',
          'notes',
          'cupping_notes',
          'purchase_date',
          'purchased_qty_lbs',
          'bean_cost',
          'tax_ship_cost',
          'last_updated',
          'user',
          'catalog_id',
          'stocked',
          'coffee_catalog!catalog_id (id, name, source, country, region, processing, cost_lb, description_short, description_long, farm_notes, cupping_notes, stocked)',
        ].join(', ');

        const { data, error } = await supabase
          .from('green_coffee_inv')
          .select(selectColumns)
          .eq('id', parseInt(id, 10))
          .eq('user', user.id)
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
          }
          throw error;
        }

        outputData(data, globalOpts);
      })
    );

  return inventory;
}
