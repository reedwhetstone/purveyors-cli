import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';
import { sanitizeFilterValue } from './catalog.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface ResolvedSaleTarget {
  roastId: number;
  mode: 'exact' | 'resolved';
}

// ─── Shared select columns ────────────────────────────────────────────────────

export const SALE_SELECT =
  'id, roast_id, oz_sold, sale_price, buyer, sell_date, user, last_updated';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const listSalesSchema = z.object({
  limit: z.number().int().min(1).default(20),
  offset: z.number().int().min(0).optional(),
  roastId: z.number().int().positive().optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  buyer: z.string().optional(),
});

export type ListSalesInput = z.input<typeof listSalesSchema>;

const saleTargetFields = {
  roastId: z.number().int().positive().optional(),
  coffeeId: z.number().int().positive().optional(),
  batchName: z.string().trim().min(1).optional(),
};

function validateSaleTargetSelector(
  value: { roastId?: number; coffeeId?: number; batchName?: string },
  ctx: z.RefinementCtx
) {
  const hasRoastId = value.roastId !== undefined;
  const hasCoffeeId = value.coffeeId !== undefined;
  const hasBatchName = value.batchName !== undefined;

  if (hasRoastId && (hasCoffeeId || hasBatchName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Use either roastId or coffeeId + batchName, not both.',
    });
    return;
  }

  if (!hasRoastId && !hasCoffeeId && !hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Provide roastId or coffeeId + batchName.',
    });
    return;
  }

  if (!hasRoastId && hasCoffeeId !== hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: hasCoffeeId ? ['batchName'] : ['coffeeId'],
      message: 'coffeeId and batchName must be provided together when roastId is absent.',
    });
  }
}

export const saleTargetSelectorSchema = z
  .object(saleTargetFields)
  .superRefine(validateSaleTargetSelector);

export type SaleTargetSelectorInput = z.input<typeof saleTargetSelectorSchema>;

export const recordSaleSchema = z
  .object({
    ...saleTargetFields,
    oz: z.number().positive(),
    price: z.number().min(0),
    buyer: z.string().optional(),
    sellDate: z.string().optional(),
  })
  .superRefine(validateSaleTargetSelector);

export type RecordSaleInput = z.input<typeof recordSaleSchema>;

export const updateSaleSchema = z
  .object({
    oz: z.number().positive().optional(),
    price: z.number().min(0).optional(),
    buyer: z.string().optional(),
    sellDate: z.string().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message: 'No update fields provided. Pass at least one of: oz, price, buyer, sellDate.',
  });

export type UpdateSaleInput = z.input<typeof updateSaleSchema>;

export const deleteSaleSchema = z.object({
  id: z.number().int().positive(),
});

export type DeleteSaleInput = z.input<typeof deleteSaleSchema>;

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * List sales for a user (newest first, with roast profile join).
 */
export async function listSales(
  supabase: SupabaseClient,
  userId: string,
  opts: ListSalesInput = {}
): Promise<Sale[]> {
  const parsed = listSalesSchema.parse(opts);

  let query = supabase
    .from('sales')
    .select(`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)`)
    .eq('user', userId);

  if (parsed.roastId !== undefined) {
    query = query.eq('roast_id', parsed.roastId);
  }

  if (parsed.dateStart !== undefined) {
    query = query.gte('sell_date', parsed.dateStart);
  }

  if (parsed.dateEnd !== undefined) {
    query = query.lte('sell_date', parsed.dateEnd);
  }

  if (parsed.buyer !== undefined) {
    const safe = sanitizeFilterValue(parsed.buyer);
    query = query.ilike('buyer', `%${safe}%`);
  }

  const offset = parsed.offset ?? 0;
  const { data, error } = await query
    .order('sell_date', { ascending: false })
    .range(offset, offset + parsed.limit - 1);

  if (error) throw error;

  return (data ?? []) as Sale[];
}

export async function resolveSaleRoast(
  supabase: SupabaseClient,
  userId: string,
  input: SaleTargetSelectorInput
): Promise<ResolvedSaleTarget> {
  const parsed = saleTargetSelectorSchema.parse(input);

  if (parsed.roastId !== undefined) {
    const { data: roastExists, error: roastError } = await supabase
      .from('roast_profiles')
      .select('roast_id')
      .eq('roast_id', parsed.roastId)
      .eq('user', userId)
      .single();

    if (roastError || !roastExists) {
      throw new AuthError(`Roast profile ${parsed.roastId} not found or does not belong to you.`);
    }

    return { roastId: parsed.roastId, mode: 'exact' };
  }

  const { data: matches, error: lookupError } = await supabase
    .from('roast_profiles')
    .select('roast_id, batch_name')
    .eq('user', userId)
    .eq('coffee_id', parsed.coffeeId!)
    .eq('batch_name', parsed.batchName!)
    .limit(2);

  if (lookupError) throw lookupError;

  const resolvedMatches = (matches ?? []) as Array<{ roast_id: number; batch_name: string | null }>;

  if (resolvedMatches.length === 0) {
    throw new PrvrsError(
      'NOT_FOUND',
      `No roast profile found for --coffee-id ${parsed.coffeeId} with batch name "${parsed.batchName}". Use 'purvey roast list --coffee-id ${parsed.coffeeId}' to inspect candidates, or pass --roast-id directly.`
    );
  }

  if (resolvedMatches.length > 1) {
    const matchIds = resolvedMatches.map((row) => row.roast_id).join(', ');
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Multiple roast profiles match --coffee-id ${parsed.coffeeId} and batch name "${parsed.batchName}". Matching roast IDs: ${matchIds}. Re-run with --roast-id.`
    );
  }

  return { roastId: resolvedMatches[0].roast_id, mode: 'resolved' };
}

/**
 * Record a new sale (target roast must belong to userId).
 */
export async function recordSale(
  supabase: SupabaseClient,
  userId: string,
  input: RecordSaleInput
): Promise<Sale> {
  const parsed = recordSaleSchema.parse(input);
  const target = await resolveSaleRoast(supabase, userId, parsed);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const insertPayload: Record<string, unknown> = {
    user: userId,
    roast_id: target.roastId,
    oz_sold: parsed.oz,
    sale_price: parsed.price,
    sell_date: parsed.sellDate ?? todayIso(),
  };

  if (parsed.buyer !== undefined) insertPayload.buyer = parsed.buyer;

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

  return data as Sale;
}

/**
 * Update an existing sale (must belong to userId).
 */
export async function updateSale(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: UpdateSaleInput
): Promise<Sale> {
  deleteSaleSchema.parse({ id });
  const parsed = updateSaleSchema.parse(input);

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('sales')
    .select('id')
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Sale ${id} not found or does not belong to you.`);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.oz !== undefined) updates.oz_sold = parsed.oz;
  if (parsed.price !== undefined) updates.sale_price = parsed.price;
  if (parsed.buyer !== undefined) updates.buyer = parsed.buyer;
  if (parsed.sellDate !== undefined) updates.sell_date = parsed.sellDate;

  if (Object.keys(updates).length === 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'No update fields provided. Pass at least one of: oz, price, buyer, sellDate.'
    );
  }

  const { error: updateError } = await supabase
    .from('sales')
    .update(updates)
    .eq('id', id)
    .eq('user', userId);

  if (updateError) throw updateError;

  // Re-fetch the updated row
  const { data, error } = await supabase
    .from('sales')
    .select(`${SALE_SELECT}, roast_profiles!roast_id (batch_name, coffee_name)`)
    .eq('id', id)
    .single();

  if (error) throw error;

  return data as Sale;
}

/**
 * Delete a sale (must belong to userId).
 */
export async function deleteSale(
  supabase: SupabaseClient,
  userId: string,
  id: number
): Promise<void> {
  deleteSaleSchema.parse({ id });

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('sales')
    .select('id')
    .eq('id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Sale ${id} not found or does not belong to you.`);
  }

  const { error: deleteError } = await supabase
    .from('sales')
    .delete()
    .eq('id', id)
    .eq('user', userId);

  if (deleteError) throw deleteError;
}
