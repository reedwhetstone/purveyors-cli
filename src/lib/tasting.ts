import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';
import type { InventoryItem } from './inventory.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface TastingData {
  beanId: number;
  filter: TastingFilter;
  supplier: SupplierTastingNotes | null;
  user: UserTastingNotes | null;
}

export interface CuppingNotes {
  aroma?: number;
  body?: number;
  acidity?: number;
  sweetness?: number;
  aftertaste?: number;
  brew_method?: string;
  notes?: string;
  rated_at?: string;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const tastingFilterSchema = z.enum(['user', 'supplier', 'both']);

export const getTastingNotesSchema = z.object({
  bean_id: z.number().int().positive().describe('Required coffee bean ID'),
  filter: tastingFilterSchema.default('both'),
});

export type GetTastingNotesInput = z.input<typeof getTastingNotesSchema>;

export const cuppingScoreSchema = z.number().int().min(1).max(5);

export const rateCoffeeSchema = z.object({
  aroma: cuppingScoreSchema,
  body: cuppingScoreSchema,
  acidity: cuppingScoreSchema,
  sweetness: cuppingScoreSchema,
  aftertaste: cuppingScoreSchema,
  brewMethod: z.string().optional(),
  notes: z.string().optional(),
});

export type RateCoffeeInput = z.input<typeof rateCoffeeSchema>;

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Validate a cupping score is an integer in [1, 5]. */
export function isValidCuppingScore(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Parse and validate a cupping score flag value (for CLI use). */
export function parseCuppingScore(raw: string, flag: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || !isValidCuppingScore(n)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `--${flag} must be an integer between 1 and 5 (got "${raw}").`
    );
  }
  return n;
}

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * Get tasting notes for a bean by coffee_catalog ID.
 * Combines supplier notes from coffee_catalog with user notes from green_coffee_inv.
 */
export async function getTastingNotes(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  filter: TastingFilter = 'both'
): Promise<TastingData> {
  getTastingNotesSchema.parse({ bean_id: id, filter });

  const result: TastingData = {
    beanId: id,
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
      .eq('id', id)
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
    const { data: invRows, error: invError } = await supabase
      .from('green_coffee_inv')
      .select('id, catalog_id, cupping_notes, notes')
      .eq('catalog_id', id)
      .eq('user', userId)
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

  return result;
}

/**
 * Rate a coffee by storing cupping scores on the inventory item (must belong to userId).
 */
export async function rateCoffee(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: RateCoffeeInput
): Promise<InventoryItem> {
  const parsed = rateCoffeeSchema.parse(input);

  // Verify ownership of the inventory item
  const { data: existing, error: fetchError } = await supabase
    .from('green_coffee_inv')
    .select('id, catalog_id')
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
  }

  const cupping: CuppingNotes = {
    aroma: parsed.aroma,
    body: parsed.body,
    acidity: parsed.acidity,
    sweetness: parsed.sweetness,
    aftertaste: parsed.aftertaste,
    rated_at: new Date().toISOString(),
  };

  if (parsed.brewMethod !== undefined) cupping.brew_method = parsed.brewMethod;
  if (parsed.notes !== undefined) cupping.notes = parsed.notes;

  const { error: updateError } = await supabase
    .from('green_coffee_inv')
    .update({ cupping_notes: cupping as unknown as string })
    .eq('id', id)
    .eq('user', userId);

  if (updateError) throw updateError;

  // Re-fetch the updated row
  const { data, error } = await supabase
    .from('green_coffee_inv')
    .select('id, catalog_id, cupping_notes, notes, last_updated')
    .eq('id', id)
    .single();

  if (error) throw error;

  return data as unknown as InventoryItem;
}
