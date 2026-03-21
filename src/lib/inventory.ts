import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export const INVENTORY_LIST_SELECT = [
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

export const INVENTORY_DETAIL_SELECT = [
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

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const listInventorySchema = z.object({
  stocked_only: z.boolean().optional().describe('Only show currently stocked beans'),
  limit: z.number().int().min(1).default(20).describe('Maximum results to return'),
});

export type ListInventoryInput = z.input<typeof listInventorySchema>;

export const getInventorySchema = z.object({
  id: z.number().int().positive(),
});

export type GetInventoryInput = z.input<typeof getInventorySchema>;

export const addInventorySchema = z.object({
  catalogId: z.number().int().positive(),
  qty: z.number().positive(),
  cost: z.number().optional(),
  taxShip: z.number().optional(),
  notes: z.string().optional(),
  purchaseDate: z.string().optional(),
});

export type AddInventoryInput = z.input<typeof addInventorySchema>;

export const updateInventorySchema = z
  .object({
    qty: z.number().positive().optional(),
    cost: z.number().optional(),
    taxShip: z.number().optional(),
    notes: z.string().optional(),
    stocked: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message: 'No update fields provided. Pass at least one of: qty, cost, taxShip, notes, stocked.',
  });

export type UpdateInventoryInput = z.input<typeof updateInventorySchema>;

export const deleteInventorySchema = z.object({
  id: z.number().int().positive(),
});

export type DeleteInventoryInput = z.input<typeof deleteInventorySchema>;

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * List green coffee inventory for a user.
 */
export async function listInventory(
  supabase: SupabaseClient,
  userId: string,
  opts: ListInventoryInput
): Promise<InventoryItem[]> {
  const parsed = listInventorySchema.parse(opts);

  let query = supabase.from('green_coffee_inv').select(INVENTORY_LIST_SELECT).eq('user', userId);

  if (parsed.stocked_only) {
    query = query.eq('stocked', true);
  }

  const { data, error } = await query
    .order('last_updated', { ascending: false })
    .limit(parsed.limit);

  if (error) throw error;

  return (data ?? []) as unknown as InventoryItem[];
}

/**
 * Fetch a single inventory item by ID (must belong to userId).
 */
export async function getInventory(
  supabase: SupabaseClient,
  userId: string,
  id: number
): Promise<InventoryItem> {
  getInventorySchema.parse({ id });

  const { data, error } = await supabase
    .from('green_coffee_inv')
    .select(INVENTORY_DETAIL_SELECT)
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
    }
    throw error;
  }

  return data as unknown as InventoryItem;
}

/**
 * Add a new inventory item for a user.
 */
export async function addInventory(
  supabase: SupabaseClient,
  userId: string,
  input: AddInventoryInput
): Promise<InventoryItem> {
  const parsed = addInventorySchema.parse(input);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const insertPayload: Record<string, unknown> = {
    user: userId,
    catalog_id: parsed.catalogId,
    purchased_qty_lbs: parsed.qty,
    purchase_date: parsed.purchaseDate ?? todayIso(),
  };

  if (parsed.cost !== undefined) insertPayload.bean_cost = parsed.cost;
  if (parsed.taxShip !== undefined) insertPayload.tax_ship_cost = parsed.taxShip;
  if (parsed.notes !== undefined) insertPayload.notes = parsed.notes;

  const { data: inserted, error: insertError } = await supabase
    .from('green_coffee_inv')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertError) throw insertError;

  // Re-fetch with catalog join
  const { data, error } = await supabase
    .from('green_coffee_inv')
    .select(INVENTORY_LIST_SELECT)
    .eq('id', inserted.id)
    .single();

  if (error) throw error;

  return data as unknown as InventoryItem;
}

/**
 * Update an existing inventory item (must belong to userId).
 */
export async function updateInventory(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: UpdateInventoryInput
): Promise<InventoryItem> {
  getInventorySchema.parse({ id });
  const parsed = updateInventorySchema.parse(input);

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('green_coffee_inv')
    .select('id')
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.qty !== undefined) updates.purchased_qty_lbs = parsed.qty;
  if (parsed.cost !== undefined) updates.bean_cost = parsed.cost;
  if (parsed.taxShip !== undefined) updates.tax_ship_cost = parsed.taxShip;
  if (parsed.notes !== undefined) updates.notes = parsed.notes;
  if (parsed.stocked !== undefined) updates.stocked = parsed.stocked;

  if (Object.keys(updates).length === 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'No update fields provided. Pass at least one of: qty, cost, taxShip, notes, stocked.'
    );
  }

  const { error: updateError } = await supabase
    .from('green_coffee_inv')
    .update(updates)
    .eq('id', id)
    .eq('user', userId);

  if (updateError) throw updateError;

  // Re-fetch the updated row
  const { data, error } = await supabase
    .from('green_coffee_inv')
    .select(INVENTORY_LIST_SELECT)
    .eq('id', id)
    .single();

  if (error) throw error;

  return data as unknown as InventoryItem;
}

/**
 * Delete an inventory item (must belong to userId).
 */
export async function deleteInventory(
  supabase: SupabaseClient,
  userId: string,
  id: number
): Promise<void> {
  deleteInventorySchema.parse({ id });

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('green_coffee_inv')
    .select('id')
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Inventory item ${id} not found or does not belong to you.`);
  }

  const { error: deleteError } = await supabase
    .from('green_coffee_inv')
    .delete()
    .eq('id', id)
    .eq('user', userId);

  if (deleteError) throw deleteError;
}
