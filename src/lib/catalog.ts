import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: number;
  name: string | null;
  source: string | null;
  continent: string | null;
  country: string | null;
  region: string | null;
  processing: string | null;
  drying_method: string | null;
  cultivar_detail: string | null;
  grade: string | null;
  appearance: string | null;
  type: string | null;
  description_short: string | null;
  description_long: string | null;
  farm_notes: string | null;
  cupping_notes: string | null;
  ai_description: string | null;
  roast_recs: string | null;
  cost_lb: number | null;
  lot_size: string | null;
  bag_size: string | null;
  score_value: number | null;
  stocked: boolean | null;
  stocked_date: string | null;
  unstocked_date: string | null;
  arrival_date: string | null;
  last_updated: string | null;
  public_coffee: boolean | null;
  wholesale: boolean | null;
  price_tiers: Array<{ min_lbs: number; price: number }> | null;
}

export interface SimilarBean {
  coffee_id: number;
  coffee_name: string;
  source: string;
  origin: string | null;
  processing: string | null;
  cost_lb: number | null;
  stocked: boolean;
  avg_similarity: number;
  chunk_matches: number;
}

export interface CatalogStats {
  total: number;
  stocked: number;
  byOrigin: Record<string, number>;
  avgPricePerLb: number | null;
  priceRange: { min: number | null; max: number | null };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const searchCatalogSchema = z.object({
  origin: z.string().optional(),
  process: z.string().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  flavor: z.string().optional(),
  stocked: z.boolean().optional(),
  limit: z.number().int().min(1).default(10),
});

export type SearchCatalogInput = z.input<typeof searchCatalogSchema>;

export const getCatalogSchema = z.object({
  id: z.number().int().positive(),
});

export type GetCatalogInput = z.input<typeof getCatalogSchema>;

export const getCatalogStatsSchema = z.object({});

export type GetCatalogStatsInput = z.input<typeof getCatalogStatsSchema>;

export const findSimilarBeansSchema = z.object({
  coffee_id: z
    .number()
    .int()
    .positive()
    .describe('The coffee_catalog ID to find similar beans for'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .optional()
    .describe('Minimum similarity score (0-1)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .describe('Maximum results to return'),
});

export type FindSimilarBeansInput = z.input<typeof findSimilarBeansSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip PostgREST special characters from user-supplied filter values.
 * Prevents injection into .or() filter strings where values are interpolated directly.
 * Removes: ( ) , . * % that have meaning in PostgREST filter syntax.
 */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/[(),.*%]/g, '');
}

/**
 * Aggregate stats from an array of catalog items.
 * Pure function — no I/O, safe to unit test.
 */
export function computeCatalogStats(items: CatalogItem[]): CatalogStats {
  const stocked = items.filter((i) => i.stocked === true).length;

  const byOrigin: Record<string, number> = {};
  for (const item of items) {
    const key = item.country ?? item.continent ?? 'Unknown';
    byOrigin[key] = (byOrigin[key] ?? 0) + 1;
  }

  const prices = items.map((i) => i.cost_lb).filter((p): p is number => p !== null);
  const avgPricePerLb =
    prices.length > 0
      ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
      : null;
  const priceRange = {
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
  };

  return { total: items.length, stocked, byOrigin, avgPricePerLb, priceRange };
}

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * Search the coffee catalog with optional filters.
 */
export async function searchCatalog(
  supabase: SupabaseClient,
  opts: SearchCatalogInput
): Promise<CatalogItem[]> {
  const parsed = searchCatalogSchema.parse(opts);

  let query = supabase.from('coffee_catalog').select('*');

  if (parsed.origin) {
    const o = sanitizeFilterValue(parsed.origin);
    query = query.or(`country.ilike.%${o}%,continent.ilike.%${o}%,region.ilike.%${o}%`);
  }

  if (parsed.process) {
    const p = sanitizeFilterValue(parsed.process);
    query = query.ilike('processing', `%${p}%`);
  }

  if (parsed.priceMin !== undefined) {
    query = query.gte('cost_lb', parsed.priceMin);
  }

  if (parsed.priceMax !== undefined) {
    query = query.lte('cost_lb', parsed.priceMax);
  }

  if (parsed.flavor) {
    const keywords = parsed.flavor
      .split(',')
      .map((k) => sanitizeFilterValue(k.trim()))
      .filter(Boolean);
    const flavorFilters = keywords
      .flatMap((kw) => [
        `description_short.ilike.%${kw}%`,
        `description_long.ilike.%${kw}%`,
        `cupping_notes.ilike.%${kw}%`,
        `farm_notes.ilike.%${kw}%`,
      ])
      .join(',');
    query = query.or(flavorFilters);
  }

  if (parsed.stocked) {
    query = query.eq('stocked', true);
  }

  const { data, error } = await query.limit(parsed.limit);
  if (error) throw error;

  return (data ?? []) as CatalogItem[];
}

/**
 * Fetch a single catalog item by ID.
 */
export async function getCatalog(supabase: SupabaseClient, id: number): Promise<CatalogItem> {
  getCatalogSchema.parse({ id });

  const { data, error } = await supabase.from('coffee_catalog').select('*').eq('id', id).single();

  if (error) throw error;
  return data as CatalogItem;
}

/**
 * Fetch aggregate statistics for the coffee catalog.
 */
export async function getCatalogStats(supabase: SupabaseClient): Promise<CatalogStats> {
  const { data, error } = await supabase
    .from('coffee_catalog')
    .select('id, country, continent, cost_lb, stocked');

  if (error) throw error;

  return computeCatalogStats((data ?? []) as CatalogItem[]);
}

/**
 * Find beans similar to a target coffee using pgvector embedding similarity.
 * Calls the `find_similar_beans_aggregated` RPC and returns ranked matches.
 */
export async function findSimilarBeans(
  supabase: SupabaseClient,
  input: FindSimilarBeansInput
): Promise<SimilarBean[]> {
  const parsed = findSimilarBeansSchema.parse(input);

  const { data, error } = await supabase.rpc('find_similar_beans_aggregated', {
    target_coffee_id: parsed.coffee_id,
    match_threshold: parsed.threshold ?? 0.7,
    match_count: parsed.limit ?? 10,
  });

  if (error) throw new Error(`RPC error: ${error.message}`);

  return (data ?? []) as SimilarBean[];
}
