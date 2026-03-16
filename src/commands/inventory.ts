import { Command } from 'commander';
import * as p from '@clack/prompts';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { getConfigValue } from '../lib/config.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import {
  listInventory,
  getInventory,
  addInventory,
  updateInventory,
  deleteInventory,
} from '../lib/inventory.js';
import type { InventoryItem } from '../lib/inventory.js';
import { pickCatalogItem, guardCancel } from '../lib/interactive/forms.js';
import type { OutputOptions } from '../types/index.js';

// Re-export type for backwards compatibility
export type { InventoryItem };

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

        const data = await listInventory(supabase, user.id, {
          stocked: opts.stocked ? true : undefined,
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
        });

        if (data.length === 0) {
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

        const data = await getInventory(supabase, user.id, parseInt(id, 10));
        outputData(data, globalOpts);
      })
    );

  // ── inventory add ─────────────────────────────────────────────────────────
  inventory
    .command('add')
    .description('Add a new green coffee inventory item')
    .option('--catalog-id <id>', 'Coffee catalog entry ID')
    .option('--qty <lbs>', 'Quantity purchased in pounds')
    .option('--cost <dollars>', 'Bean cost in dollars')
    .option('--tax-ship <dollars>', 'Tax and shipping cost in dollars')
    .option('--notes <text>', 'Notes for this inventory item')
    .option('--purchase-date <YYYY-MM-DD>', 'Purchase date (defaults to today)')
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
          (!(opts.catalogId && opts.qty) && (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
          p.intro('Add Bean to Inventory');

          const catalogItem = await pickCatalogItem(supabase);

          const qtyRaw = await p.text({
            message: 'Quantity (lbs)',
            placeholder: '5',
            validate: (v) => {
              const n = parseFloat(String(v));
              if (isNaN(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(qtyRaw);

          const costRaw = await p.text({
            message: 'Cost per lb ($)',
            placeholder: 'optional',
          });
          guardCancel(costRaw);

          const notesRaw = await p.text({
            message: 'Notes',
            placeholder: 'optional',
          });
          guardCancel(notesRaw);

          const confirmed = await p.confirm({ message: 'Add this bean?' });
          guardCancel(confirmed);

          if (!confirmed) {
            p.cancel('Aborted.');
            return;
          }

          const costStr = String(costRaw).trim();
          const cost = costStr !== '' ? parseFloat(costStr) : undefined;
          const notesStr = String(notesRaw).trim();
          const notes = notesStr !== '' ? notesStr : undefined;
          const qtyStr = String(qtyRaw);

          const data = await addInventory(supabase, user.id, {
            catalogId: catalogItem.id,
            qty: parseFloat(qtyStr),
            cost,
            notes,
            purchaseDate: todayIso(),
          });

          p.outro(`Bean added! Inventory item #${data.id} created.`);
          outputData(data, globalOpts);
          return;
        }

        // ── Flag-based mode ────────────────────────────────────────────────
        if (!opts.catalogId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --catalog-id. Use --form for interactive mode.'
          );
        }
        if (!opts.qty) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --qty. Use --form for interactive mode.'
          );
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

        const cost = opts.cost !== undefined ? parseFloat(opts.cost as string) : undefined;
        if (cost !== undefined && isNaN(cost)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
        }

        const taxShip = opts.taxShip !== undefined ? parseFloat(opts.taxShip as string) : undefined;
        if (taxShip !== undefined && isNaN(taxShip)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --tax-ship: "${opts.taxShip}".`);
        }

        const data = await addInventory(supabase, user.id, {
          catalogId,
          qty,
          cost,
          taxShip,
          notes: opts.notes as string | undefined,
          purchaseDate: (opts.purchaseDate as string | undefined) ?? todayIso(),
        });

        success(`Inventory item ${data.id} created.`);
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

        // Parse CLI strings into typed values
        let qty: number | undefined;
        if (opts.qty !== undefined) {
          qty = parseFloat(opts.qty as string);
          if (isNaN(qty) || qty <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --qty: "${opts.qty}".`);
        }

        let cost: number | undefined;
        if (opts.cost !== undefined) {
          cost = parseFloat(opts.cost as string);
          if (isNaN(cost))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
        }

        let taxShip: number | undefined;
        if (opts.taxShip !== undefined) {
          taxShip = parseFloat(opts.taxShip as string);
          if (isNaN(taxShip))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --tax-ship: "${opts.taxShip}".`);
        }

        let stocked: boolean | undefined;
        if (opts.stocked !== undefined) {
          const stockedStr = (opts.stocked as string).toLowerCase();
          if (stockedStr !== 'true' && stockedStr !== 'false') {
            throw new PrvrsError('INVALID_ARGUMENT', `--stocked must be "true" or "false".`);
          }
          stocked = stockedStr === 'true';
        }

        if (
          qty === undefined &&
          cost === undefined &&
          taxShip === undefined &&
          opts.notes === undefined &&
          stocked === undefined
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --qty, --cost, --tax-ship, --notes, --stocked.'
          );
        }

        const data = await updateInventory(supabase, user.id, itemId, {
          qty,
          cost,
          taxShip,
          notes: opts.notes as string | undefined,
          stocked,
        });

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
        void cmd;
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

        if (!opts.yes) {
          const ok = await confirm(`Delete inventory item ${itemId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        await deleteInventory(supabase, user.id, itemId);
        success(`Inventory item ${itemId} deleted.`);
      })
    );

  return inventory;
}
