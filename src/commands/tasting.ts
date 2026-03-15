import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import type { OutputOptions } from '../types/index.js';

// ─── Local types ──────────────────────────────────────────────────────────────

export type TastingFilter = 'user' | 'supplier' | 'both';

export interface SupplierTastingNotes {
  source: 'supplier';
  catalogId: number;
  name: string | null;
  processing: string | null;
  region: string | null;
  cupping_notes: string | null;
  ai_tasting_notes: unknown | null;
  ai_description: string | null;
}

export interface UserTastingNotes {
  source: 'user';
  inventoryId: number;
  catalogId: number | null;
  cupping_notes: string | null;
  notes: string | null;
}

export interface TastingResult {
  beanId: number;
  filter: TastingFilter;
  supplier: SupplierTastingNotes | null;
  user: UserTastingNotes | null;
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `prvrs tasting` — View tasting notes for a bean.
 * Combines supplier notes from coffee_catalog with user notes from green_coffee_inv.
 * Requires authentication.
 */
export function buildTastingCommand(): Command {
  const tasting = new Command('tasting').description('View tasting notes for a coffee bean');

  // ── tasting get <bean-id> ─────────────────────────────────────────────────
  tasting
    .command('get <bean-id>')
    .description(
      'Retrieve tasting notes for a bean (by coffee_catalog ID). Combines supplier and user notes.'
    )
    .option(
      '--filter <type>',
      'Which notes to show: user, supplier, or both (default: both)',
      'both'
    )
    .action(
      withErrorHandling(async (beanId: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const filter = opts.filter as string as TastingFilter;

        if (!['user', 'supplier', 'both'].includes(filter)) {
          throw new PrvrsError(
            'INVALID_OPTION',
            `Invalid --filter value "${filter}". Use: user, supplier, or both.`
          );
        }

        const catalogId = parseInt(beanId, 10);
        if (isNaN(catalogId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid bean ID: "${beanId}".`);
        }

        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `prvrs auth login` first.');
        }

        const result: TastingResult = {
          beanId: catalogId,
          filter,
          supplier: null,
          user: null,
        };

        // ── Supplier notes (from coffee_catalog) ─────────────────────────
        if (filter === 'supplier' || filter === 'both') {
          const { data: catalogRow, error: catalogError } = await supabase
            .from('coffee_catalog')
            .select(
              'id, name, processing, region, source, cupping_notes, ai_tasting_notes, ai_description'
            )
            .eq('id', catalogId)
            .single();

          if (catalogError && catalogError.code !== 'PGRST116') {
            throw catalogError;
          }

          if (catalogRow) {
            result.supplier = {
              source: 'supplier',
              catalogId: catalogRow.id,
              name: catalogRow.name ?? null,
              processing: catalogRow.processing ?? null,
              region: catalogRow.region ?? null,
              cupping_notes: catalogRow.cupping_notes ?? null,
              ai_tasting_notes: catalogRow.ai_tasting_notes ?? null,
              ai_description: catalogRow.ai_description ?? null,
            };
          }
        }

        // ── User notes (from green_coffee_inv) ───────────────────────────
        if (filter === 'user' || filter === 'both') {
          // A user might have multiple inventory items from the same catalog entry
          const { data: invRows, error: invError } = await supabase
            .from('green_coffee_inv')
            .select('id, catalog_id, cupping_notes, notes')
            .eq('catalog_id', catalogId)
            .eq('user', user.id)
            .order('id', { ascending: false })
            .limit(1);

          if (invError) throw invError;

          if (invRows && invRows.length > 0) {
            const row = invRows[0];
            result.user = {
              source: 'user',
              inventoryId: row.id,
              catalogId: row.catalog_id ?? null,
              cupping_notes: row.cupping_notes ?? null,
              notes: row.notes ?? null,
            };
          }
        }

        // If nothing found at all, let the user know
        if (result.supplier === null && result.user === null) {
          info(`No tasting notes found for bean ID ${catalogId} (filter: ${filter}).`);
          return;
        }

        outputData(result, globalOpts);
      })
    );

  return tasting;
}
