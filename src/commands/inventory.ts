import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
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

// ─── Shared select columns ────────────────────────────────────────────────────

const LIST_SELECT = [
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

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey inventory` — Manage your green coffee inventory.
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
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        let query = supabase.from('green_coffee_inv').select(LIST_SELECT).eq('user', user.id);

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
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
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

  // ── inventory add ─────────────────────────────────────────────────────────
  inventory
    .command('add')
    .description('Add a new green coffee inventory item')
    .requiredOption('--catalog-id <id>', 'Coffee catalog entry ID')
    .requiredOption('--qty <lbs>', 'Quantity purchased in pounds')
    .option('--cost <dollars>', 'Bean cost in dollars')
    .option('--tax-ship <dollars>', 'Tax and shipping cost in dollars')
    .option('--notes <text>', 'Notes for this inventory item')
    .option('--purchase-date <YYYY-MM-DD>', 'Purchase date (defaults to today)')
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

        const catalogId = parseInt(opts.catalogId as string, 10);
        if (isNaN(catalogId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --catalog-id: "${opts.catalogId}".`);
        }

        const qty = parseFloat(opts.qty as string);
        if (isNaN(qty) || qty <= 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --qty: "${opts.qty}". Must be a positive number.`
          );
        }

        const insertPayload: Record<string, unknown> = {
          user: user.id,
          catalog_id: catalogId,
          purchased_qty_lbs: qty,
          purchase_date: (opts.purchaseDate as string | undefined) ?? todayIso(),
        };

        if (opts.cost !== undefined) {
          const cost = parseFloat(opts.cost as string);
          if (isNaN(cost))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
          insertPayload.bean_cost = cost;
        }

        if (opts.taxShip !== undefined) {
          const taxShip = parseFloat(opts.taxShip as string);
          if (isNaN(taxShip))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --tax-ship: "${opts.taxShip}".`);
          insertPayload.tax_ship_cost = taxShip;
        }

        if (opts.notes !== undefined) {
          insertPayload.notes = opts.notes;
        }

        const { data: inserted, error: insertError } = await supabase
          .from('green_coffee_inv')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertError) throw insertError;

        // Re-fetch the full row with catalog join
        const { data, error } = await supabase
          .from('green_coffee_inv')
          .select(LIST_SELECT)
          .eq('id', inserted.id)
          .single();

        if (error) throw error;

        success(`Inventory item ${inserted.id} created.`);
        outputData(data, globalOpts);
      })
    );

  // ── inventory update <id> ─────────────────────────────────────────────────
  inventory
    .command('update <id>')
    .description('Update an existing inventory item (must be yours)')
    .option('--qty <lbs>', 'Updated quantity in pounds')
    .option('--cost <dollars>', 'Updated bean cost')
    .option('--tax-ship <dollars>', 'Updated tax/shipping cost')
    .option('--notes <text>', 'Updated notes')
    .option('--stocked <bool>', 'Mark as stocked (true/false)')
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

        const itemId = parseInt(id, 10);
        if (isNaN(itemId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid inventory ID: "${id}".`);
        }

        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from('green_coffee_inv')
          .select('id')
          .eq('id', itemId)
          .eq('user', user.id)
          .single();

        if (fetchError || !existing) {
          throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
        }

        // Build partial update — only include fields that were explicitly passed
        const updates: Record<string, unknown> = {};

        if (opts.qty !== undefined) {
          const qty = parseFloat(opts.qty as string);
          if (isNaN(qty) || qty <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --qty: "${opts.qty}".`);
          updates.purchased_qty_lbs = qty;
        }

        if (opts.cost !== undefined) {
          const cost = parseFloat(opts.cost as string);
          if (isNaN(cost))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
          updates.bean_cost = cost;
        }

        if (opts.taxShip !== undefined) {
          const taxShip = parseFloat(opts.taxShip as string);
          if (isNaN(taxShip))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --tax-ship: "${opts.taxShip}".`);
          updates.tax_ship_cost = taxShip;
        }

        if (opts.notes !== undefined) {
          updates.notes = opts.notes;
        }

        if (opts.stocked !== undefined) {
          const stockedStr = (opts.stocked as string).toLowerCase();
          if (stockedStr !== 'true' && stockedStr !== 'false') {
            throw new PrvrsError('INVALID_ARGUMENT', `--stocked must be "true" or "false".`);
          }
          updates.stocked = stockedStr === 'true';
        }

        if (Object.keys(updates).length === 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --qty, --cost, --tax-ship, --notes, --stocked.'
          );
        }

        const { error: updateError } = await supabase
          .from('green_coffee_inv')
          .update(updates)
          .eq('id', itemId)
          .eq('user', user.id);

        if (updateError) throw updateError;

        // Re-fetch the updated row
        const { data, error } = await supabase
          .from('green_coffee_inv')
          .select(LIST_SELECT)
          .eq('id', itemId)
          .single();

        if (error) throw error;

        success(`Inventory item ${itemId} updated.`);
        outputData(data, globalOpts);
      })
    );

  // ── inventory delete <id> ─────────────────────────────────────────────────
  inventory
    .command('delete <id>')
    .description('Delete an inventory item (must be yours)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd; // global opts not needed for delete
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        const itemId = parseInt(id, 10);
        if (isNaN(itemId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid inventory ID: "${id}".`);
        }

        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from('green_coffee_inv')
          .select('id, catalog_id')
          .eq('id', itemId)
          .eq('user', user.id)
          .single();

        if (fetchError || !existing) {
          throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
        }

        if (!opts.yes) {
          const ok = await confirm(`Delete inventory item ${itemId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const { error: deleteError } = await supabase
          .from('green_coffee_inv')
          .delete()
          .eq('id', itemId)
          .eq('user', user.id);

        if (deleteError) throw deleteError;

        success(`Inventory item ${itemId} deleted.`);
      })
    );

  return inventory;
}
