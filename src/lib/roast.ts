import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';
import { sanitizeFilterValue } from './catalog.js';
import { importArtisanData } from './artisan/import.js';
import type { ArtisanImportResult } from './artisan/import.js';

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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const listRoastsSchema = z.object({
  coffee_id: z.number().int().positive().optional().describe('Filter by green coffee inventory ID'),
  roast_id: z.number().int().positive().optional().describe('Filter by roast profile ID'),
  batch_name: z
    .string()
    .optional()
    .describe('Filter by batch name (partial match, case-insensitive)'),
  date_start: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only show roasts on or after this date'),
  date_end: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only show roasts on or before this date'),
  stocked_only: z.boolean().optional().describe('Only show roasts for currently stocked beans'),
  catalog_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filter by coffee_catalog ID (cross-reference from catalog search)'),
  limit: z.number().int().min(1).default(20).describe('Maximum results to return'),
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

export const updateRoastSchema = z
  .object({
    notes: z.string().optional(),
    ozOut: z.number().positive().optional(),
    batchName: z.string().optional(),
    targets: z.string().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message: 'No update fields provided. Pass at least one of: notes, ozOut, batchName, targets.',
  });

export type UpdateRoastInput = z.input<typeof updateRoastSchema>;

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

  if (parsed.coffee_id !== undefined) {
    query = query.eq('coffee_id', parsed.coffee_id);
  }

  if (parsed.roast_id !== undefined) {
    query = query.eq('roast_id', parsed.roast_id);
  }

  if (parsed.batch_name) {
    const safe = sanitizeFilterValue(parsed.batch_name);
    query = query.ilike('batch_name', `%${safe}%`);
  }

  if (parsed.date_start) {
    query = query.gte('roast_date', parsed.date_start);
  }

  if (parsed.date_end) {
    query = query.lte('roast_date', parsed.date_end);
  }

  // stocked_only and catalog_id require filtering through the green_coffee_inv FK.
  // Use Supabase's inner-join filter: select from roast_profiles with
  // green_coffee_inv!coffee_id!inner(...) to restrict to matching inventory rows.
  if (parsed.stocked_only === true || parsed.catalog_id !== undefined) {
    // Build a joined select to filter on green_coffee_inv columns.
    // We fetch inventory IDs matching the criteria, then filter roast_profiles.
    let invQuery = supabase.from('green_coffee_inv').select('id').eq('user', userId);

    if (parsed.stocked_only === true) {
      invQuery = invQuery.eq('stocked', true);
    }

    if (parsed.catalog_id !== undefined) {
      invQuery = invQuery.eq('catalog_id', parsed.catalog_id);
    }

    const { data: invRows, error: invError } = await invQuery;
    if (invError) throw invError;

    const invIds = (invRows ?? []).map((r) => (r as { id: number }).id);

    if (invIds.length === 0) {
      // No matching inventory items; return empty
      return [];
    }

    query = query.in('coffee_id', invIds);
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

/**
 * Update an existing roast profile (must belong to userId).
 * If ozOut is provided and the roast has oz_in, weight_loss_percent is recalculated.
 */
export async function updateRoast(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: UpdateRoastInput
): Promise<RoastProfile> {
  deleteRoastSchema.parse({ id });
  const parsed = updateRoastSchema.parse(input);

  // Verify ownership and get current profile (need oz_in for weight loss calc)
  const { data: existing, error: fetchError } = await supabase
    .from('roast_profiles')
    .select('roast_id, oz_in')
    .eq('roast_id', id)
    .eq('user', userId)
    .single();

  if (fetchError || !existing) {
    throw new AuthError(`Roast profile ${id} not found or does not belong to you.`);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.notes !== undefined) updates.roast_notes = parsed.notes;
  if (parsed.batchName !== undefined) updates.batch_name = parsed.batchName;
  if (parsed.targets !== undefined) updates.roast_targets = parsed.targets;
  if (parsed.ozOut !== undefined) {
    updates.oz_out = parsed.ozOut;
    // Recalculate weight_loss_percent if oz_in exists
    const ozIn = existing.oz_in as number | null;
    if (ozIn != null && ozIn > 0) {
      updates.weight_loss_percent = Math.round(((ozIn - parsed.ozOut) / ozIn) * 10000) / 100;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'No update fields provided. Pass at least one of: --notes, --oz-out, --batch-name, --targets.'
    );
  }

  const { error: updateError } = await supabase
    .from('roast_profiles')
    .update(updates)
    .eq('roast_id', id)
    .eq('user', userId);

  if (updateError) throw updateError;

  // Re-fetch the updated row
  const { data, error } = await supabase
    .from('roast_profiles')
    .select(ROAST_DETAIL_SELECT)
    .eq('roast_id', id)
    .single();

  if (error) throw error;

  return data as RoastProfile;
}

// ─── Roast import from .alog file ─────────────────────────────────────────────

export const importRoastSchema = z.object({
  fileContent: z.string().min(1),
  fileName: z.string().min(1),
  coffeeId: z.number().int().positive(),
  batchName: z.string().optional(),
  ozIn: z.number().positive().optional(),
  roastNotes: z.string().optional(),
});

export type ImportRoastInput = z.input<typeof importRoastSchema>;

export interface ImportRoastResult extends ArtisanImportResult {
  roast_id: number;
  batch_name: string;
  coffee_name: string;
  coffee_id: number;
}

/**
 * Extract the input weight in ounces from an Artisan .alog weight array.
 * Falls back to undefined if weight data is absent or unparseable.
 *
 * @param weight - The `weight` field from ArtisanRoastData: [input, output, unit]
 */
export function extractOzFromAlog(
  weight: [number, number, string] | undefined
): number | undefined {
  if (!weight || !Array.isArray(weight) || weight.length < 3) return undefined;
  const [inputWeight, , unit] = weight;
  if (typeof inputWeight !== 'number' || inputWeight <= 0) return undefined;
  if (typeof unit !== 'string') return undefined;

  const unitLower = unit.toLowerCase();
  if (unitLower === 'g' || unitLower === 'gr' || unitLower === 'gram' || unitLower === 'grams') {
    return inputWeight / 28.3495;
  }
  if (unitLower === 'oz' || unitLower === 'ounce' || unitLower === 'ounces') {
    return inputWeight;
  }
  if (unitLower === 'kg' || unitLower === 'kilogram' || unitLower === 'kilograms') {
    return inputWeight * 35.274;
  }
  if (
    unitLower === 'lb' ||
    unitLower === 'lbs' ||
    unitLower === 'pound' ||
    unitLower === 'pounds'
  ) {
    return inputWeight * 16;
  }
  // Unknown unit — return undefined rather than a wrong number
  return undefined;
}

/**
 * Generate a default batch name: "{coffee_name} {YYYY-MM-DD}".
 */
export function defaultBatchName(coffeeName: string, dateIso: string): string {
  return `${coffeeName} ${dateIso}`;
}

/**
 * Import a roast from an Artisan .alog file in one step:
 *   1. Verify inventory ownership + get coffee name
 *   2. Create a new roast_profile row
 *   3. Run the full Artisan import (temperatures, events, profile metadata)
 *   4. Return the combined result
 *
 * The supabase client must already be authenticated as userId.
 */
export async function importRoastFromFile(
  supabase: SupabaseClient,
  userId: string,
  input: ImportRoastInput
): Promise<ImportRoastResult> {
  const parsed = importRoastSchema.parse(input);

  // 1. Verify ownership and get coffee name
  const { data: invItem, error: invError } = await supabase
    .from('green_coffee_inv')
    .select('id, coffee_catalog!catalog_id (name)')
    .eq('id', parsed.coffeeId)
    .eq('user', userId)
    .single();

  if (invError || !invItem) {
    throw new AuthError(`Inventory item ${parsed.coffeeId} not found or does not belong to you.`);
  }

  const catalogRaw = invItem.coffee_catalog as
    | { name: string | null }
    | { name: string | null }[]
    | null;
  const catalog = Array.isArray(catalogRaw) ? (catalogRaw[0] ?? null) : catalogRaw;
  const coffeeName = catalog?.name ?? `Coffee #${parsed.coffeeId}`;

  // 2. Extract roast date + weight from the .alog if not provided by caller
  let artisanRaw: Record<string, unknown> | undefined;
  try {
    // Light pre-parse to grab roastdate and weight without a full import cycle.
    // We import parseArtisanFile lazily here to keep imports tidy.
    const { parseArtisanFile } = await import('./artisan/import.js');
    const artisan = await parseArtisanFile(parsed.fileContent, parsed.fileName);
    artisanRaw = artisan as unknown as Record<string, unknown>;
  } catch {
    // Pre-parse failure is non-fatal here; the real import will surface the error
  }

  const roastDate: string =
    (artisanRaw?.roastdate as string | undefined) ?? new Date().toISOString().slice(0, 10);

  let ozIn = parsed.ozIn;
  if (ozIn === undefined && artisanRaw?.weight) {
    ozIn = extractOzFromAlog(artisanRaw.weight as [number, number, string]);
  }

  const batchName = parsed.batchName ?? defaultBatchName(coffeeName, roastDate);

  // 3. Create roast_profile row
  const insertPayload: Record<string, unknown> = {
    user: userId,
    coffee_id: parsed.coffeeId,
    coffee_name: coffeeName,
    batch_name: batchName,
    roast_date: roastDate,
    data_source: 'artisan_import',
  };
  if (ozIn !== undefined) insertPayload.oz_in = ozIn;
  if (parsed.roastNotes !== undefined) insertPayload.roast_notes = parsed.roastNotes;

  const { data: inserted, error: insertError } = await supabase
    .from('roast_profiles')
    .insert(insertPayload)
    .select('roast_id')
    .single();

  if (insertError) throw insertError;

  const roastId: number = (inserted as { roast_id: number }).roast_id;

  // 4. Run the full Artisan import (updates profile metadata + writes temps/events)
  const importResult = await importArtisanData(
    supabase,
    roastId,
    userId,
    parsed.fileContent,
    parsed.fileName
  );

  return {
    ...importResult,
    roast_id: roastId,
    batch_name: batchName,
    coffee_name: coffeeName,
    coffee_id: parsed.coffeeId,
  };
}
