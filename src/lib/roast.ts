import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoastProfile {
  roast_id: number;
  batch_name: string | null;
  coffee_id: number | null;
  coffee_name: string | null;
  roast_date: string | null;
  oz_in: number | null;
  oz_out: number | null;
  weight_loss_percent: number | null;
  roast_notes: string | null;
  user: string;
  last_updated: string;
  roaster_type: string | null;
  roaster_size: string | null;
  temperature_unit: string | null;
  charge_time: number | null;
  drop_time: number | null;
  fc_start_time: number | null;
  fc_end_time: number | null;
  fc_start_temp: number | null;
  drop_temp: number | null;
  charge_temp: number | null;
  dry_percent: number | null;
  maillard_percent: number | null;
  development_percent: number | null;
  total_roast_time: number | null;
  data_source: string | null;
  roast_uuid: string | null;
  temperatures?: TemperatureEntry[];
  events?: RoastEventEntry[];
}

export interface TemperatureEntry {
  roast_id: number;
  time_seconds: number;
  bean_temp: number | null;
  environmental_temp: number | null;
}

export interface RoastEventEntry {
  roast_id: number;
  time_seconds: number;
  event_type: number | null;
  event_value: string | null;
}

// ─── Shared select columns ────────────────────────────────────────────────────

const ROAST_LIST_SELECT =
  'roast_id, batch_name, coffee_id, coffee_name, roast_date, oz_in, oz_out, weight_loss_percent, roast_notes, roaster_type, roaster_size, temperature_unit, total_roast_time, development_percent, data_source, last_updated';

const ROAST_DETAIL_SELECT =
  'roast_id, batch_name, coffee_id, coffee_name, roast_date, oz_in, oz_out, weight_loss_percent, roast_notes, roaster_type, total_roast_time, data_source, last_updated';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const listRoastsSchema = z.object({
  coffeeId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).default(20),
});

export type ListRoastsInput = z.input<typeof listRoastsSchema>;

export const getRoastSchema = z.object({
  id: z.number().int().positive(),
  includeTemps: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
});

export type GetRoastInput = z.input<typeof getRoastSchema>;

export const createRoastSchema = z.object({
  coffeeId: z.number().int().positive(),
  batchName: z.string().optional(),
  ozIn: z.number().positive().optional(),
  ozOut: z.number().positive().optional(),
  roastDate: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateRoastInput = z.input<typeof createRoastSchema>;

export const deleteRoastSchema = z.object({
  id: z.number().int().positive(),
});

export type DeleteRoastInput = z.input<typeof deleteRoastSchema>;

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * List roast profiles for a user.
 */
export async function listRoasts(
  supabase: SupabaseClient,
  userId: string,
  opts: ListRoastsInput
): Promise<RoastProfile[]> {
  const parsed = listRoastsSchema.parse(opts);

  let query = supabase.from('roast_profiles').select(ROAST_LIST_SELECT).eq('user', userId);

  if (parsed.coffeeId !== undefined) {
    query = query.eq('coffee_id', parsed.coffeeId);
  }

  const { data, error } = await query.order('roast_date', { ascending: false }).limit(parsed.limit);

  if (error) throw error;

  return (data ?? []) as RoastProfile[];
}

/**
 * Fetch a single roast profile by ID (must belong to userId).
 * Optionally includes temperature curve and roast events.
 */
export async function getRoast(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  opts: { includeTemps?: boolean; includeEvents?: boolean } = {}
): Promise<RoastProfile> {
  getRoastSchema.parse({ id, ...opts });

  const { data: profile, error: profileError } = await supabase
    .from('roast_profiles')
    .select('*')
    .eq('roast_id', id)
    .eq('user', userId)
    .single();

  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new AuthError(`Roast profile ${id} not found or does not belong to you.`);
    }
    throw profileError;
  }

  const result: RoastProfile = { ...profile };

  if (opts.includeTemps) {
    const { data: temps, error: tempError } = await supabase
      .from('roast_temperatures')
      .select('roast_id, time_seconds, bean_temp, environmental_temp')
      .eq('roast_id', id)
      .order('time_seconds', { ascending: true });

    if (tempError) throw tempError;
    result.temperatures = (temps ?? []) as TemperatureEntry[];
  }

  if (opts.includeEvents) {
    const { data: events, error: eventsError } = await supabase
      .from('roast_events')
      .select('roast_id, time_seconds, event_type, event_value')
      .eq('roast_id', id)
      .order('time_seconds', { ascending: true });

    if (eventsError) throw eventsError;
    result.events = (events ?? []) as RoastEventEntry[];
  }

  return result;
}

/**
 * Create a new roast profile (coffeeId must be an inventory item belonging to userId).
 */
export async function createRoast(
  supabase: SupabaseClient,
  userId: string,
  input: CreateRoastInput
): Promise<RoastProfile> {
  const parsed = createRoastSchema.parse(input);

  const todayIso = () => new Date().toISOString().slice(0, 10);

  // Verify ownership of the inventory item and get coffee name for default batch name
  const { data: invItem, error: invError } = await supabase
    .from('green_coffee_inv')
    .select('id, coffee_catalog!catalog_id (name)')
    .eq('id', parsed.coffeeId)
    .eq('user', userId)
    .single();

  if (invError || !invItem) {
    throw new AuthError(`Inventory item ${parsed.coffeeId} not found or does not belong to you.`);
  }

  const roastDate = parsed.roastDate ?? todayIso();

  let batchName = parsed.batchName;
  if (!batchName) {
    const catalogRaw = invItem.coffee_catalog as
      | { name: string | null }
      | { name: string | null }[]
      | null;
    const catalog = Array.isArray(catalogRaw) ? (catalogRaw[0] ?? null) : catalogRaw;
    const coffeeName = catalog?.name ?? `Coffee #${parsed.coffeeId}`;
    batchName = `${coffeeName} — ${roastDate}`;
  }

  const insertPayload: Record<string, unknown> = {
    user: userId,
    coffee_id: parsed.coffeeId,
    batch_name: batchName,
    roast_date: roastDate,
  };

  if (parsed.ozIn !== undefined) insertPayload.oz_in = parsed.ozIn;
  if (parsed.ozOut !== undefined) insertPayload.oz_out = parsed.ozOut;
  if (parsed.notes !== undefined) insertPayload.roast_notes = parsed.notes;

  const { data: inserted, error: insertError } = await supabase
    .from('roast_profiles')
    .insert(insertPayload)
    .select('roast_id')
    .single();

  if (insertError) throw insertError;

  // Re-fetch the full row
  const { data, error } = await supabase
    .from('roast_profiles')
    .select(ROAST_DETAIL_SELECT)
    .eq('roast_id', inserted.roast_id)
    .single();

  if (error) throw error;

  return data as RoastProfile;
}

/**
 * Delete a roast profile (must belong to userId).
 */
export async function deleteRoast(
  supabase: SupabaseClient,
  userId: string,
  id: number
): Promise<void> {
  deleteRoastSchema.parse({ id });

  if (isNaN(id)) {
    throw new PrvrsError('INVALID_ARGUMENT', `Invalid roast ID: "${id}".`);
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('roast_profiles')
    .select('roast_id')
    .eq('roast_id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Roast profile ${id} not found or does not belong to you.`);
  }

  const { error: deleteError } = await supabase
    .from('roast_profiles')
    .delete()
    .eq('roast_id', id)
    .eq('user', userId);

  if (deleteError) throw deleteError;
}
