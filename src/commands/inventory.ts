import { Command } from 'commander';
import * as p from '@clack/prompts';
import { getConfigValue } from '../lib/config.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
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
 * Requires member+ authentication.
 */
export function buildInventoryCommand(): Command {
  const inventory = new Command('inventory').description('Manage your green coffee inventory');

  // ── inventory list ────────────────────────────────────────────────────────
  inventory
    .command('list')
    .description('List your green coffee inventory with catalog details')
    .option('--stocked', 'Only show currently stocked beans')
    .option('--limit <n>', 'Maximum results to return', '20')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory list --pretty
  purvey inventory list --stocked --pretty
  purvey inventory list --limit 50 | jq '.[].id'
  purvey inventory list --csv > inventory.csv

Notes:
  Returns your green_coffee_inv rows joined with catalog details.
  The "id" field in each row is your inventory ID (used for roast --coffee-id,
  tasting rate, etc.) — distinct from catalog_id.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        const data = await listInventory(supabase, userId, {
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
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory get 7 --pretty
  purvey inventory get 42 | jq '{id, qty, cost, stocked}'

Notes:
  <id> is green_coffee_inv.id (integer).
  Row-level security: only returns items belonging to the logged-in user.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        const data = await getInventory(supabase, userId, parseInt(id, 10));
        outputData(data, globalOpts);
      })
    );

  // ── inventory add ─────────────────────────────────────────────────────────
  inventory
    .command('add')
    .description('Add a new green coffee inventory item')
    .option('--catalog-id <id>', '[REQUIRED] Coffee catalog entry ID (coffee_catalog.catalog_id)')
    .option('--qty <lbs>', '[REQUIRED] Quantity purchased in pounds')
    .option('--cost <dollars>', 'Bean cost in dollars (optional)')
    .option('--tax-ship <dollars>', 'Tax and shipping cost in dollars (optional)')
    .option('--notes <text>', 'Notes for this inventory item (optional)')
    .option('--purchase-date <YYYY-MM-DD>', 'Purchase date (defaults to today)')
    .option('--form', 'Interactive form mode (prompts for all fields)')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory add --catalog-id 128 --qty 10 --cost 8.50 --pretty
  purvey inventory add --catalog-id 42 --qty 5 --cost 6.25 --tax-ship 4.00
  purvey inventory add --catalog-id 77 --qty 25 --purchase-date 2026-03-01
  purvey inventory add --form      # interactive wizard

Required flags: --catalog-id, --qty
  Use 'purvey catalog search' to find a --catalog-id.
  Use --form if you prefer to browse and select interactively.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

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

          const spin = p.spinner();
          spin.start('Adding bean to inventory...');
          const data = await addInventory(supabase, userId, {
            catalogId: catalogItem.id,
            qty: parseFloat(qtyStr),
            cost,
            notes,
            purchaseDate: todayIso(),
          });
          spin.stop('Done');

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

        const data = await addInventory(supabase, userId, {
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
    .option('--stocked <bool>', 'Mark as stocked: true or false')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory update 7 --qty 8.5
  purvey inventory update 7 --stocked false
  purvey inventory update 7 --cost 9.00 --notes "bulk discount applied"
  purvey inventory update 42 --stocked true --qty 15

Notes:
  At least one flag required. Pass only the fields you want to change.
  --stocked accepts "true" or "false" (string, not flag).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

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

        const data = await updateInventory(supabase, userId, itemId, {
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
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory delete 7           # prompts for confirmation
  purvey inventory delete 7 --yes     # skip confirmation (use in scripts)

Notes:
  Permanently deletes the inventory row. Cannot be undone.
  Row-level security: only items belonging to you can be deleted.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const { supabase, userId } = await requireAuth('member');

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

        await deleteInventory(supabase, userId, itemId);
        success(`Inventory item ${itemId} deleted.`);
      })
    );

  return inventory;
}
