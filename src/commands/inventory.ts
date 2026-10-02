import { Command } from 'commander';
import * as p from '@clack/prompts';
import { getConfigValue } from '../lib/config.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import { confirm, todayIso } from '../lib/prompts.js';
import {
  listInventory,
  getInventory,
  addInventory,
  updateInventory,
  deleteInventory,
  POSTGRES_INT4_MIN,
} from '../lib/inventory.js';
import type { InventoryItem, DeleteInventoryResult } from '../lib/inventory.js';
import { pickCatalogItem, guardCancel } from '../lib/interactive/forms.js';
import {
  parseStrictFiniteNumber,
  parseStrictInt4Id,
  parseStrictInteger,
  POSTGRES_INT4_MAX,
  parseStrictOffset,
  parseStrictPositiveCount,
} from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

// Re-export type for backwards compatibility
export type { InventoryItem };

function parseInventoryId(value: string, label: string): number {
  const parsed = parseStrictInt4Id(value);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError('INVALID_ARGUMENT', `Invalid ${label}: "${value}".`);
  }
  return parsed;
}

function parseListCount(value: string, flag: '--limit' | '--offset'): number {
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
    .option('--stocked')
    .option('--catalog-id <id>')
    .option('--purchase-date-start <YYYY-MM-DD>')
    .option('--purchase-date-end <YYYY-MM-DD>')
    .option('--origin <country>')
    .option('--limit <n>', '', '20')
    .option('--offset <n>', '', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory list --pretty
  purvey inventory list --stocked --pretty
  purvey inventory list --catalog-id 128 --pretty
  purvey inventory list --origin Ethiopia --pretty
  purvey inventory list --purchase-date-start 2026-01-01 --purchase-date-end 2026-03-31
  purvey inventory list --stocked --origin Colombia --limit 10
  purvey inventory list --limit 50 | jq '.[].id'
  purvey inventory list --csv > inventory.csv
  purvey inventory list --limit 20 --offset 20   # page 2

Notes:
  Returns your inventory items with their catalog details.
  The "id" field in each row is your inventory ID (used for roast --coffee-id,
  tasting rate, etc.) — distinct from catalog_id.
  --offset + --limit enables pagination through large result sets.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        let catalogId: number | undefined;
        if (opts.catalogId !== undefined) {
          catalogId = parseInventoryId(opts.catalogId as string, '--catalog-id');
        }

        const data = await listInventory({
          stocked_only: opts.stocked ? true : undefined,
          limit: parseListCount(opts.limit as string, '--limit'),
          offset: parseListCount(opts.offset as string, '--offset'),
          catalogId,
          purchaseDateStart: opts.purchaseDateStart as string | undefined,
          purchaseDateEnd: opts.purchaseDateEnd as string | undefined,
          origin: opts.origin as string | undefined,
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
  <id> is your inventory ID (integer).
  Only returns items that belong to you.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await getInventory(parseInventoryId(id, 'inventory ID'));
        outputData(data, globalOpts);
      })
    );

  // ── inventory add ─────────────────────────────────────────────────────────
  inventory
    .command('add')
    .description('Add a new green coffee inventory item')
    .option('--catalog-id <id>')
    .option('--manual-name <name>')
    .option('--qty <lbs>')
    .option('--cost <dollars>')
    .option('--tax-ship <dollars>')
    .option('--notes <text>')
    .option('--purchase-date <YYYY-MM-DD>')
    .option('--form')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory add --catalog-id 128 --qty 10 --cost 85.00 --pretty
  purvey inventory add --catalog-id 42 --qty 5 --cost 31.25 --tax-ship 4.00
  purvey inventory add --catalog-id 77 --qty 25 --purchase-date 2026-03-01
  purvey inventory add --manual-name "Farm-gate Ethiopia lot 7" --qty 12 --cost 96
  purvey inventory add --form      # interactive wizard

Required flags: --qty and exactly one of --catalog-id or --manual-name
  Use 'purvey catalog search' to find a --catalog-id.
  Use --form if you prefer to browse and select interactively.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        // ── Interactive form mode ──────────────────────────────────────────
        // Auto-enter form mode if config form-mode is true and required args are missing
        const formMode =
          opts.form ||
          (!((opts.catalogId || opts.manualName) && opts.qty) &&
            (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
          const { credentialContext } = await requireAuth('member');
          p.intro('Add Bean to Inventory');

          const catalogItem = await pickCatalogItem();

          const qtyRaw = await p.text({
            message: 'Quantity (lbs)',
            placeholder: '5',
            validate: (v) => {
              const n = parseStrictFiniteNumber(String(v));
              if (!Number.isFinite(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(qtyRaw);

          const costRaw = await p.text({
            message: 'Total bean cost ($)',
            placeholder: 'optional',
            validate: (v) => {
              if (!v || v.trim() === '') return;
              const n = parseStrictFiniteNumber(v);
              if (!Number.isFinite(n)) return 'Must be a number.';
            },
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
          const cost = costStr !== '' ? parseStrictFiniteNumber(costStr) : undefined;
          const notesStr = String(notesRaw).trim();
          const notes = notesStr !== '' ? notesStr : undefined;
          const qtyStr = String(qtyRaw);

          const spin = p.spinner();
          spin.start('Adding bean to inventory...');
          const {
            data: { session: formSession },
          } = await credentialContext.getSession();
          if (!formSession?.apiKey) {
            throw new AuthError('Session expired mid-form. Run `purvey auth login` and retry.');
          }
          const data = await addInventory(
            {
              catalogId: catalogItem.id,
              qty: parseStrictFiniteNumber(qtyStr),
              cost,
              notes,
              purchaseDate: todayIso(),
            },
            formSession.apiKey
          );
          spin.stop('Done');

          p.outro(`Bean added! Inventory item #${data.id} created.`);
          outputData(data, globalOpts);
          return;
        }

        // ── Flag-based mode ────────────────────────────────────────────────
        if (opts.catalogId && opts.manualName !== undefined) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Pass either --catalog-id or --manual-name, not both.'
          );
        }
        const manualName =
          opts.manualName !== undefined ? String(opts.manualName).trim() : undefined;
        if (manualName === '') {
          throw new PrvrsError('INVALID_ARGUMENT', '--manual-name cannot be blank.');
        }
        if (!opts.catalogId && manualName === undefined) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --catalog-id (or --manual-name for a coffee not in the catalog). Use --form for interactive mode.'
          );
        }
        if (!opts.qty) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --qty. Use --form for interactive mode.'
          );
        }

        const catalogId =
          manualName === undefined
            ? parseInventoryId(opts.catalogId as string, '--catalog-id')
            : undefined;

        const qty = parseStrictFiniteNumber(opts.qty as string);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --qty: "${opts.qty}". Must be a positive number.`
          );
        }

        const cost =
          opts.cost !== undefined ? parseStrictFiniteNumber(opts.cost as string) : undefined;
        if (cost !== undefined && !Number.isFinite(cost)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
        }

        const taxShip =
          opts.taxShip !== undefined ? parseStrictFiniteNumber(opts.taxShip as string) : undefined;
        if (taxShip !== undefined && !Number.isFinite(taxShip)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --tax-ship: "${opts.taxShip}".`);
        }

        const data = await addInventory({
          ...(manualName === undefined ? { catalogId } : { manualName }),
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
    .option('--qty <lbs>')
    .option('--cost <dollars>')
    .option('--tax-ship <dollars>')
    .option('--notes <text>')
    .option('--stocked <bool>')
    .option('--rank <n>')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory update 7 --qty 8.5
  purvey inventory update 7 --stocked false
  purvey inventory update 7 --cost 9.00 --notes "bulk discount applied"
  purvey inventory update 42 --stocked true --qty 15
  purvey inventory update 42 --rank 1

Notes:
  At least one flag required. Pass only the fields you want to change.
  --stocked accepts "true" or "false" (string, not flag).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const itemId = parseInventoryId(id, 'inventory ID');

        // Parse CLI strings into typed values
        let qty: number | undefined;
        if (opts.qty !== undefined) {
          qty = parseStrictFiniteNumber(opts.qty as string);
          if (!Number.isFinite(qty) || qty <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --qty: "${opts.qty}".`);
        }

        let cost: number | undefined;
        if (opts.cost !== undefined) {
          cost = parseStrictFiniteNumber(opts.cost as string);
          if (!Number.isFinite(cost))
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --cost: "${opts.cost}".`);
        }

        let taxShip: number | undefined;
        if (opts.taxShip !== undefined) {
          taxShip = parseStrictFiniteNumber(opts.taxShip as string);
          if (!Number.isFinite(taxShip))
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

        let rank: number | undefined;
        if (opts.rank !== undefined) {
          rank = parseStrictInteger(String(opts.rank), POSTGRES_INT4_MIN, POSTGRES_INT4_MAX);
          if (!Number.isFinite(rank)) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --rank: "${String(opts.rank)}". Must be an integer.`
            );
          }
        }

        if (
          qty === undefined &&
          cost === undefined &&
          taxShip === undefined &&
          opts.notes === undefined &&
          stocked === undefined &&
          rank === undefined
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --qty, --cost, --tax-ship, --notes, --stocked, --rank.'
          );
        }

        const data = await updateInventory(itemId, {
          qty,
          cost,
          taxShip,
          notes: opts.notes as string | undefined,
          stocked,
          rank,
        });

        success(`Inventory item ${itemId} updated.`);
        outputData(data, globalOpts);
      })
    );

  // ── inventory delete <id> ─────────────────────────────────────────────────
  inventory
    .command('delete <id>')
    .description('Delete an inventory item (must be yours)')
    .option('-y, --yes')
    .addHelpText(
      'after',
      `
Examples:
  purvey inventory delete 7             # prompts for confirmation
  purvey inventory delete 7 --yes       # skip confirmation (use in scripts)

Notes:
  Permanently deletes the inventory item. Cannot be undone.
  If the item has dependent roast profiles or sales records, the command fails
  with DEPENDENCY_CONFLICT. Delete those records explicitly before retrying.
  Only items that belong to you can be deleted.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const itemId = parseInventoryId(id, 'inventory ID');

        if (!opts.yes) {
          const ok = await confirm(`Delete inventory item ${itemId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const result: DeleteInventoryResult = await deleteInventory(itemId);
        success(`Inventory item ${itemId} deleted.`);

        if (globalOpts.json || globalOpts.pretty) {
          outputData(result, globalOpts);
        }
      })
    );

  return inventory;
}
