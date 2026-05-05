import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogProofFamily {
  label: string;
  confidence: number | null;
  signals: string[];
  message: string;
}

export interface CatalogProofSummary {
  version: string;
  overall: {
    label: string;
    families_with_signals: number;
  };
  families: Record<string, CatalogProofFamily>;
  limitations: string[];
}

export interface CatalogItem {
  id: number;
  name: string | null;
  source: string | null;
  continent: string | null;
  country: string | null;
  region: string | null;
  processing: string | null;
  processing_base_method: string | null;
  fermentation_type: string | null;
  process_additives: string[] | null;
  process_additive_detail: string | null;
  fermentation_duration_hours: number | null;
  processing_notes: string | null;
  processing_disclosure_level: string | null;
  processing_confidence: number | null;
  processing_evidence_available: boolean | null;
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
  price_per_lb: number | null;
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
  proof?: CatalogProofSummary | null;
}

export interface SimilarBean {
  coffee_id: number;
  coffee_name: string;
  source: string;
  origin: string | null;
  processing: string | null;
  cost_lb: number | null;
  price_per_lb: number | null;
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

export const catalogSortFields = ['price', 'price-desc', 'name', 'origin', 'newest'] as const;
export type CatalogSortField = (typeof catalogSortFields)[number];

export const searchCatalogSchema = z.object({
  origin: z.string().optional(),
  process: z.string().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  flavor: z.string().optional(),
  stocked: z.boolean().optional(),
  sort: z.enum(catalogSortFields).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(10),
  name: z.string().optional(),
  supplier: z.string().optional(),
  ids: z.array(z.number().int().positive()).max(100).optional(),
  variety: z.string().optional(),
  dryingMethod: z.string().optional(),
  stockedDays: z.number().int().positive().optional(),
  processingBaseMethod: z.string().optional(),
  fermentationType: z.string().optional(),
  processAdditive: z.string().optional(),
  processingDisclosureLevel: z.string().optional(),
  processingConfidenceMin: z.number().min(0).max(1).optional(),
  includeProof: z.boolean().optional(),
});

export type SearchCatalogInput = z.input<typeof searchCatalogSchema>;

export const getCatalogSchema = z.object({
  id: z.number().int().positive(),
  includeProof: z.boolean().optional(),
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

/** Get per-lb price, preferring price_tiers then generated column then legacy cost_lb */
function getPerLbPrice(item: {
  price_tiers?: Array<{ price: number }> | null;
  price_per_lb?: number | null;
  cost_lb?: number | null;
}): number | null {
  return item.price_tiers?.[0]?.price ?? item.price_per_lb ?? item.cost_lb ?? null;
}

interface CatalogApiEnvelope {
  data?: unknown;
  error?: unknown;
  message?: unknown;
  code?: unknown;
}

const CATALOG_API_SORT_MAP: Partial<
  Record<CatalogSortField, { field: string; direction: 'asc' | 'desc' }>
> = {
  price: { field: 'price_per_lb', direction: 'asc' },
  'price-desc': { field: 'price_per_lb', direction: 'desc' },
  name: { field: 'name', direction: 'asc' },
  origin: { field: 'country', direction: 'asc' },
  newest: { field: 'stocked_date', direction: 'desc' },
};

function getCatalogApiBaseUrl(): string {
  return (process.env.PURVEYORS_BASE_URL ?? 'https://www.purveyors.io').replace(/\/+$/, '');
}

async function getCatalogApiAuthHeader(supabase: SupabaseClient): Promise<string> {
  const apiKey = process.env.PARCHMENT_API_KEY ?? process.env.PURVEYORS_API_KEY;
  if (apiKey) {
    return `Bearer ${apiKey}`;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new AuthError(
      'Catalog proof output requires a Purveyors session or API key. Run `purvey auth login`, or set PARCHMENT_API_KEY/PURVEYORS_API_KEY for API-backed catalog proof reads.'
    );
  }

  return `Bearer ${session.access_token}`;
}

function appendSearchParam(
  params: URLSearchParams,
  name: string,
  value: string | number | boolean | undefined
): void {
  if (value === undefined) return;
  params.append(name, String(value));
}

function hasCatalogIdFilter(parsed: Pick<z.infer<typeof searchCatalogSchema>, 'ids'>): boolean {
  return parsed.ids !== undefined && parsed.ids.length > 0;
}

function assertCatalogApiCompatibleSearch(parsed: z.infer<typeof searchCatalogSchema>): void {
  const unsupportedFilters: string[] = [];
  if (parsed.flavor) unsupportedFilters.push('--flavor');
  if (parsed.supplier) unsupportedFilters.push('--supplier');
  if (parsed.dryingMethod) unsupportedFilters.push('--drying-method');
  if (parsed.sort === 'newest') unsupportedFilters.push('--sort newest');

  if (unsupportedFilters.length > 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `--include-proof uses /v1/catalog and cannot safely preserve ${unsupportedFilters.join(
        ', '
      )} yet. Omit those filters or run the default catalog search without --include-proof.`
    );
  }

  if (hasCatalogIdFilter(parsed)) return;

  const offset = parsed.offset ?? 0;
  if (offset > 0 && offset % parsed.limit !== 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `--include-proof uses /v1/catalog page-based pagination; --offset must be a multiple of --limit. Received offset=${offset}, limit=${parsed.limit}.`
    );
  }
}

function buildCatalogApiUrl(parsed: z.infer<typeof searchCatalogSchema>): URL {
  assertCatalogApiCompatibleSearch(parsed);

  const url = new URL('/v1/catalog', getCatalogApiBaseUrl());
  const params = url.searchParams;

  params.set('include', 'proof');
  params.set('stocked', parsed.stocked ? 'true' : 'all');

  appendSearchParam(params, 'origin', parsed.origin);
  appendSearchParam(params, 'processing', parsed.process);
  appendSearchParam(params, 'processing_base_method', parsed.processingBaseMethod);
  appendSearchParam(params, 'fermentation_type', parsed.fermentationType);
  appendSearchParam(params, 'process_additive', parsed.processAdditive);
  appendSearchParam(params, 'processing_disclosure_level', parsed.processingDisclosureLevel);
  appendSearchParam(params, 'processing_confidence_min', parsed.processingConfidenceMin);
  appendSearchParam(params, 'price_per_lb_min', parsed.priceMin);
  appendSearchParam(params, 'price_per_lb_max', parsed.priceMax);
  appendSearchParam(params, 'name', parsed.name);
  appendSearchParam(params, 'cultivar_detail', parsed.variety);
  appendSearchParam(params, 'stocked_days', parsed.stockedDays);

  for (const id of parsed.ids ?? []) {
    params.append('ids', String(id));
  }

  const sort = parsed.sort ? CATALOG_API_SORT_MAP[parsed.sort] : undefined;
  if (sort) {
    params.set('sortField', sort.field);
    params.set('sortDirection', sort.direction);
  }

  if (!hasCatalogIdFilter(parsed)) {
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit;
    params.set('limit', String(limit));
    if (offset > 0) {
      params.set('page', String(Math.floor(offset / limit) + 1));
    }
  }

  return url;
}

async function parseCatalogApiError(response: Response): Promise<PrvrsError> {
  let body: CatalogApiEnvelope | undefined;
  try {
    body = (await response.json()) as CatalogApiEnvelope;
  } catch {
    body = undefined;
  }

  const serverMessage =
    typeof body?.message === 'string'
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : response.statusText;
  const details = { status: response.status, body };

  if (response.status === 401 || response.status === 403) {
    return new AuthError(`Catalog API authentication failed: ${serverMessage}`, details);
  }

  if (response.status === 400) {
    return new PrvrsError(
      'INVALID_ARGUMENT',
      `Catalog API rejected include=proof: ${serverMessage}. Verify the configured Purveyors API endpoint supports the proof summary include.`,
      details
    );
  }

  if (response.status === 404) {
    return new PrvrsError(
      'CONFIG_ERROR',
      'Catalog API endpoint not found. Set PURVEYORS_BASE_URL to a Purveyors deployment that supports /v1/catalog?include=proof.',
      details
    );
  }

  return new PrvrsError(
    'GENERAL_ERROR',
    `Catalog API request failed (${response.status}): ${serverMessage}`,
    details
  );
}

async function fetchCatalogApiItems(
  supabase: SupabaseClient,
  parsed: z.infer<typeof searchCatalogSchema>
): Promise<CatalogItem[]> {
  const url = buildCatalogApiUrl(parsed);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: await getCatalogApiAuthHeader(supabase),
    },
  });

  if (!response.ok) {
    throw await parseCatalogApiError(response);
  }

  const envelope = (await response.json()) as CatalogApiEnvelope;
  if (!Array.isArray(envelope.data)) {
    throw new PrvrsError(
      'GENERAL_ERROR',
      'Catalog API returned an unexpected response shape for include=proof; expected { data: [...] }.',
      { body: envelope }
    );
  }

  return envelope.data as CatalogItem[];
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

  const prices = items.map((i) => getPerLbPrice(i)).filter((p): p is number => p !== null);
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

  if (parsed.includeProof) {
    return fetchCatalogApiItems(supabase, parsed);
  }

  let query = supabase.from('coffee_catalog').select('*');

  if (parsed.origin) {
    const o = sanitizeFilterValue(parsed.origin);
    query = query.or(`country.ilike.%${o}%,continent.ilike.%${o}%,region.ilike.%${o}%`);
  }

  if (parsed.process) {
    const p = sanitizeFilterValue(parsed.process);
    query = query.ilike('processing', `%${p}%`);
  }

  if (parsed.processingBaseMethod) {
    query = query.eq('processing_base_method', sanitizeFilterValue(parsed.processingBaseMethod));
  }

  if (parsed.fermentationType) {
    query = query.eq('fermentation_type', sanitizeFilterValue(parsed.fermentationType));
  }

  if (parsed.processAdditive) {
    query = query.contains('process_additives', [sanitizeFilterValue(parsed.processAdditive)]);
  }

  if (parsed.processingDisclosureLevel) {
    query = query.eq(
      'processing_disclosure_level',
      sanitizeFilterValue(parsed.processingDisclosureLevel)
    );
  }

  if (parsed.processingConfidenceMin !== undefined) {
    query = query.gte('processing_confidence', parsed.processingConfidenceMin);
  }

  if (parsed.priceMin !== undefined) {
    query = query.gte('price_per_lb', parsed.priceMin);
  }

  if (parsed.priceMax !== undefined) {
    query = query.lte('price_per_lb', parsed.priceMax);
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

  if (parsed.name) {
    const n = sanitizeFilterValue(parsed.name);
    query = query.ilike('name', `%${n}%`);
  }

  if (parsed.supplier) {
    const s = sanitizeFilterValue(parsed.supplier);
    query = query.ilike('source', `%${s}%`);
  }

  if (parsed.ids && parsed.ids.length > 0) {
    // coffee_catalog PK is `id`; `catalog_id` is the FK name on other tables
    query = query.in('id', parsed.ids);
  }

  if (parsed.variety) {
    const v = sanitizeFilterValue(parsed.variety);
    query = query.ilike('cultivar_detail', `%${v}%`);
  }

  if (parsed.dryingMethod) {
    const d = sanitizeFilterValue(parsed.dryingMethod);
    query = query.ilike('drying_method', `%${d}%`);
  }

  if (parsed.stockedDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parsed.stockedDays);
    query = query.gte('stocked_date', cutoff.toISOString().slice(0, 10));
  }

  if (parsed.stocked) {
    query = query.eq('stocked', true);
  }

  // Apply sort order
  if (parsed.sort) {
    switch (parsed.sort) {
      case 'price':
        query = query.order('price_per_lb', { ascending: true, nullsFirst: false });
        break;
      case 'price-desc':
        query = query.order('price_per_lb', { ascending: false, nullsFirst: false });
        break;
      case 'name':
        query = query.order('name', { ascending: true, nullsFirst: false });
        break;
      case 'origin':
        query = query.order('country', { ascending: true, nullsFirst: false });
        break;
      case 'newest':
        query = query.order('last_updated', { ascending: false, nullsFirst: false });
        break;
    }
  }

  // Apply offset/limit for pagination (skip when fetching specific IDs)
  if (!parsed.ids || parsed.ids.length === 0) {
    const offset = parsed.offset ?? 0;
    query = query.range(offset, offset + parsed.limit - 1);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as CatalogItem[];
}

/**
 * Fetch a single catalog item by ID.
 */
export async function getCatalog(
  supabase: SupabaseClient,
  id: number,
  opts: { includeProof?: boolean } = {}
): Promise<CatalogItem> {
  const parsed = getCatalogSchema.parse({ id, includeProof: opts.includeProof });

  if (parsed.includeProof) {
    const rows = await fetchCatalogApiItems(supabase, {
      ids: [parsed.id],
      limit: 1,
      includeProof: true,
    });
    const item = rows[0];
    if (!item) {
      throw new PrvrsError('NOT_FOUND', `Coffee ID ${parsed.id} not found in catalog.`);
    }
    return item;
  }

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
    .select('id, country, continent, price_per_lb, price_tiers, cost_lb, stocked');

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
