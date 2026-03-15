import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemperatureRow {
  roast_id: number;
  time_seconds: number;
  bean_temp?: number | null;
  environmental_temp?: number | null;
  ambient_temp?: number | null;
  ror_bean_temp?: number | null;
  data_source: string;
}

export interface EventRow {
  roast_id: number;
  time_seconds: number;
  event_type: number;
  event_value: string | null;
  event_string: string;
  category: string;
  subcategory: string;
  user_generated: boolean;
  automatic: boolean;
  notes?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const BATCH_SIZE = 100;

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Clear existing roast data scoped to artisan_import source.
 * Deletes temperature rows by data_source and event rows by category.
 */
export async function clearRoastData(
  supabase: SupabaseClient,
  roastId: number,
  source: 'artisan_import' | 'live'
): Promise<void> {
  await supabase
    .from('roast_temperatures')
    .delete()
    .eq('roast_id', roastId)
    .eq('data_source', source);

  if (source === 'artisan_import') {
    await supabase
      .from('roast_events')
      .delete()
      .eq('roast_id', roastId)
      .in('category', ['milestone', 'control', 'machine']);
  } else {
    await supabase.from('roast_events').delete().eq('roast_id', roastId);
  }
}

/**
 * Batch-insert temperature rows into roast_temperatures.
 */
export async function insertTemperatures(
  supabase: SupabaseClient,
  entries: TemperatureRow[]
): Promise<void> {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('roast_temperatures').insert(batch);
    if (error) {
      console.error('Error inserting temperature batch:', error);
      throw error;
    }
  }
}

/**
 * Batch-insert event rows into roast_events.
 */
export async function insertEvents(supabase: SupabaseClient, entries: EventRow[]): Promise<void> {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('roast_events').insert(batch);
    if (error) {
      console.error('Error inserting event batch:', error);
      throw error;
    }
  }
}
