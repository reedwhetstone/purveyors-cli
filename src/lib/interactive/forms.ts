/**
 * Interactive form helpers for `purvey` write commands.
 * CLI-only — not exported via package.json subpaths.
 * All functions use @clack/prompts for step-by-step TUI wizards.
 */

import * as p from '@clack/prompts';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Cancel guard ─────────────────────────────────────────────────────────────

/** Call after any clack result to abort cleanly on Ctrl+C / Escape. */
export function guardCancel(result: unknown): void {
  if (p.isCancel(result)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

/**
 * Interactive bean picker — shows user's inventory beans and lets them select one.
 * Returns the selected bean's ID and name.
 */
export async function pickBean(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: number; name: string }> {
  const { data, error } = await supabase
    .from('green_coffee_inv')
    .select('id, coffee_catalog!catalog_id (name)')
    .eq('user', userId)
    .eq('stocked', true)
    .order('id', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: number;
    coffee_catalog: { name: string | null } | { name: string | null }[] | null;
  }>;

  if (rows.length === 0) {
    p.cancel('No stocked beans found in your inventory. Add some first.');
    process.exit(0);
  }

  const options = rows.map((row) => {
    const catalog = Array.isArray(row.coffee_catalog)
      ? (row.coffee_catalog[0] ?? null)
      : row.coffee_catalog;
    const name = catalog?.name ?? `Bean #${row.id}`;
    return { value: String(row.id), label: `${name} (#${row.id})`, hint: name };
  });

  const selected = await p.select({
    message: 'Select a bean from your inventory',
    options,
  });

  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.id === selectedId);
  const catalog = Array.isArray(matchedRow?.coffee_catalog)
    ? (matchedRow?.coffee_catalog[0] ?? null)
    : (matchedRow?.coffee_catalog ?? null);
  const name = catalog?.name ?? `Bean #${selectedId}`;

  return { id: selectedId, name };
}

/**
 * Interactive roast picker — shows user's roast profiles, lets them select one.
 * Returns the selected roast's ID and batch name.
 */
export async function pickRoast(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: number; batchName: string }> {
  const { data, error } = await supabase
    .from('roast_profiles')
    .select('roast_id, batch_name, roast_date')
    .eq('user', userId)
    .order('roast_date', { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    roast_id: number;
    batch_name: string | null;
    roast_date: string | null;
  }>;

  if (rows.length === 0) {
    p.cancel('No roast profiles found. Create one first.');
    process.exit(0);
  }

  const options = rows.map((row) => {
    const label = row.batch_name ?? `Roast #${row.roast_id}`;
    const hint = row.roast_date ?? undefined;
    return { value: String(row.roast_id), label, hint };
  });

  const selected = await p.select({
    message: 'Select a roast profile',
    options,
  });

  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.roast_id === selectedId);
  const batchName = matchedRow?.batch_name ?? `Roast #${selectedId}`;

  return { id: selectedId, batchName };
}

/**
 * Interactive catalog search — user types search term, sees matching coffees.
 * Returns selected catalog item ID and name.
 */
export async function pickCatalogItem(
  supabase: SupabaseClient
): Promise<{ id: number; name: string }> {
  const searchTerm = await p.text({
    message: 'Search coffee catalog (origin, name, or flavor)',
    placeholder: 'e.g. Ethiopia, natural, berry',
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'Please enter a search term.';
    },
  });

  guardCancel(searchTerm);

  const term = (searchTerm as string).trim();
  const safe = term.replace(/[(),.*%]/g, '');

  const { data, error } = await supabase
    .from('coffee_catalog')
    .select('id, name, country, processing, price_per_lb, cost_lb')
    .or(
      [
        `name.ilike.%${safe}%`,
        `country.ilike.%${safe}%`,
        `continent.ilike.%${safe}%`,
        `region.ilike.%${safe}%`,
        `cupping_notes.ilike.%${safe}%`,
        `description_short.ilike.%${safe}%`,
      ].join(',')
    )
    .limit(20);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: number;
    name: string | null;
    country: string | null;
    processing: string | null;
    price_per_lb: number | null;
    cost_lb: number | null;
  }>;

  if (rows.length === 0) {
    p.cancel(`No coffees found matching "${term}". Try a different search.`);
    process.exit(0);
  }

  const options = rows.map((row) => {
    const label = row.name ?? `Catalog #${row.id}`;
    const parts = [
      row.country,
      row.processing,
      (row.price_per_lb ?? row.cost_lb) ? `$${row.price_per_lb ?? row.cost_lb}/lb` : null,
    ].filter(Boolean);
    const hint = parts.join(' · ') || undefined;
    return { value: String(row.id), label, hint };
  });

  const selected = await p.select({
    message: 'Select a coffee',
    options,
  });

  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.id === selectedId);
  const name = matchedRow?.name ?? `Catalog #${selectedId}`;

  return { id: selectedId, name };
}
