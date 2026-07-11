import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';
import {
  createParchmentClient,
  getParchmentBaseUrl,
  resolveParchmentToken,
  unwrapParchment,
} from './parchment.js';

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
  purveyor_score: number | null;
  purveyor_score_confidence: number | null;
  purveyor_score_tier: string | null;
  purveyor_score_factors: unknown;
  purveyor_score_version: string | null;
  purveyor_score_updated_at: string | null;
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

export type CatalogSimilarityMode = 'all' | 'likely_same' | 'similar_profile';
export type CatalogMatchCategory = 'likely_same' | 'similar_profile';
export type CatalogMatchKind = 'canonical_candidate' | 'similar_recommendation';
export type CatalogIdentityEligibility = 'eligible' | 'blocked' | 'insufficient_evidence';
export type CatalogMatchConfidenceLabel = 'high_beta' | 'medium_beta' | 'low_beta';
export type CatalogSimilarityQueryStrategy =
  | 'bounded-vector-candidates-v1'
  | 'canonical-vector-aggregated-v2'
  | 'legacy-vector-aggregated-v1';

export interface CatalogCanonicalPricing {
  price_per_lb: number | null;
  price_tiers: unknown;
  cost_lb: number | null;
  baseline_quantity_lbs: 1;
  baseline_price_per_lb: number | null;
  baseline_source: 'price_per_lb' | 'price_tiers' | 'cost_lb' | null;
}

export interface CatalogIdentityBlocker {
  code: string;
  severity: 'hard' | 'soft';
  target_value: string | null;
  candidate_value: string | null;
}

export interface CatalogMatchClassification {
  kind: CatalogMatchKind;
  identity_eligibility: CatalogIdentityEligibility;
  confidence: CatalogMatchConfidenceLabel;
  blockers: CatalogIdentityBlocker[];
  evidence: string[];
}

export interface CatalogSimilarityQuery {
  threshold: number;
  limit: number;
  stockedOnly: boolean;
  mode: CatalogSimilarityMode;
}

export interface CatalogSimilarityTargetSummary {
  id: number;
  name: string;
  source: string | null;
  origin: string | null;
  country: string | null;
  continent: string | null;
  processing: string | null;
  processing_base_method: string | null;
  fermentation_type: string | null;
  drying_method: string | null;
  stocked: boolean | null;
  arrival_date: string | null;
  stocked_date: string | null;
  price_per_lb: number | null;
  price_tiers: unknown;
  cost_lb: number | null;
  pricing: CatalogCanonicalPricing;
  proof: CatalogProofSummary;
}

export interface CatalogSimilarityMatch {
  coffee: {
    id: number;
    name: string;
    source: string | null;
    origin: string | null;
    country: string | null;
    continent: string | null;
    processing: string | null;
    processing_base_method: string | null;
    fermentation_type: string | null;
    drying_method: string | null;
    stocked: boolean | null;
    arrival_date: string | null;
    stocked_date: string | null;
    proof: CatalogProofSummary;
  };
  pricing: CatalogCanonicalPricing;
  price_delta_1lb: {
    amount: number | null;
    percent: number | null;
    currency: 'USD';
  };
  score: {
    average: number;
    dimensions: {
      origin: number | null;
      processing: number | null;
      tasting: number | null;
    };
    chunk_matches: number;
  };
  match: {
    category: CatalogMatchCategory;
    classification: CatalogMatchClassification;
    confidence: CatalogMatchConfidenceLabel;
    beta: true;
    language: string;
  };
  explanation: {
    summary: string;
    signals: string[];
  };
  compatibility: {
    cost_lb: number | null;
  };
}

export interface CatalogSimilarityResponse {
  data: {
    target: CatalogSimilarityTargetSummary;
    groups: {
      canonical_candidates: CatalogSimilarityMatch[];
      similar_recommendations: CatalogSimilarityMatch[];
    };
    matches?: CatalogSimilarityMatch[];
  };
  meta: {
    resource: 'catalog-similarity';
    namespace: '/v1/catalog/{id}/similar';
    version: 'v1';
    status: 'beta';
    auth?: {
      kind: 'session' | 'api-key';
      role: string | null;
      apiPlan: unknown;
    };
    access?: {
      requiredCapability: 'canUseBeanMatching';
      canUseBeanMatching: true;
    };
    query: CatalogSimilarityQuery;
    copy?: {
      confidence: string;
    };
    classification_version: 'canonical-match-v1';
    query_strategy: CatalogSimilarityQueryStrategy;
  };
}

export interface CatalogStats {
  total: number;
  stocked: number;
  byOrigin: Record<string, number>;
  avgPricePerLb: number | null;
  priceRange: { min: number | null; max: number | null };
}

export type PurveyorScoreBand = 'premium' | 'strong' | 'scored' | 'unscored';

export interface PurveyorScoreSummary {
  value: number | null;
  band: PurveyorScoreBand;
  source: 'purveyor_score';
  confidence: number | null;
  tier: string | null;
  factors: unknown;
  version: string | null;
  updated_at: string | null;
  note: string;
}

export interface CatalogPremiumRankedItem {
  rank: number;
  id: number;
  name: string | null;
  supplier: string | null;
  origin: {
    continent: string | null;
    country: string | null;
    region: string | null;
  };
  processing: {
    label: string | null;
    base_method: string | null;
    fermentation_type: string | null;
    drying_method: string | null;
  };
  purveyor_score: PurveyorScoreSummary;
  pricing: {
    price_per_lb: number | null;
    cost_lb: number | null;
    price_tiers: Array<{ min_lbs: number; price: number }> | null;
  };
  stocked: boolean | null;
  stocked_date: string | null;
  signals: string[];
}

export interface CatalogPremiumRanking {
  data: CatalogPremiumRankedItem[];
  meta: {
    resource: 'catalog-premium-ranking';
    scoring_source: 'coffee_catalog.purveyor_score';
    sample_size: number;
    sample_limited: boolean;
    sample_order: 'purveyor_score_desc_nulls_last';
    truncated: boolean;
    returned: number;
    filters: {
      origin?: string;
      process?: string;
      supplier?: string;
      stocked?: boolean;
      priceMax?: number;
      minScore?: number;
      includeUnscored: boolean;
    };
    caveats: string[];
  };
}

export interface SupplierAggregate {
  supplier: string;
  total: number;
  stocked: number;
  score: {
    average: number | null;
    coverage: number;
    scored_count: number;
    top_score: number | null;
    average_confidence: number | null;
    confidence_coverage: number;
  };
  price: {
    average_per_lb: number | null;
    min_per_lb: number | null;
    max_per_lb: number | null;
  };
  origins: string[];
  processing_methods: string[];
  top_coffees: CatalogPremiumRankedItem[];
}

export interface SupplierAggregateResponse {
  data: SupplierAggregate[];
  meta: {
    resource: 'supplier-list' | 'supplier-detail' | 'supplier-rank';
    sample_size: number;
    sample_limited: boolean;
    sample_order: 'source_asc_nulls_last';
    truncated: boolean;
    rows_examined: number;
    returned: number;
    filters: {
      supplier?: string;
      country?: string;
      stocked?: boolean;
      minCoffees?: number;
      nonWholesaleOnly: boolean;
    };
    caveats: string[];
  };
}

export type CatalogFacetField =
  | 'supplier'
  | 'country'
  | 'processing_base_method'
  | 'fermentation_type'
  | 'drying_method'
  | 'grade'
  | 'wholesale';

export interface CatalogFacetValue {
  value: string;
  count: number;
}

export interface CatalogFacetsResponse {
  data: CatalogFacetValue[];
  meta: {
    resource: 'catalog-facets';
    field: CatalogFacetField;
    source_column: string;
    stocked_only: boolean;
    scope: 'stocked_only' | 'all_visible';
    sample_size: number;
    sample_limited: boolean;
    sample_order: 'id_asc';
    truncated: boolean;
    rows_examined: number;
    distinct_values: number;
    returned: number;
    caveats: string[];
  };
}

export type CatalogRankObjective = 'premium' | 'value' | 'fresh_arrival' | 'rare_origin';

export interface CatalogRankedItem extends CatalogItem {
  rank: number;
  rank_basis: string;
}

export interface CatalogRankingResponse {
  data: CatalogRankedItem[];
  meta: {
    resource: 'catalog-ranking';
    objective: CatalogRankObjective;
    scoring_source: 'coffee_catalog.purveyor_score';
    sample_size: number;
    sample_limited: boolean;
    sample_order: 'id_asc';
    truncated: boolean;
    candidates_considered: number;
    returned: number;
    filters: {
      supplier?: string;
      country?: string;
      process?: string;
      stocked_only: boolean;
      scope: 'stocked_only' | 'all_visible';
      priceMax?: number;
      minScore?: number;
      nonWholesaleOnly: boolean;
    };
    caveats: string[];
  };
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

const CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE = 5000;
const CATALOG_PREMIUM_DEFAULT_SAMPLE_SIZE = 250;
const SUPABASE_DATA_API_MAX_PAGE_SIZE = 1000;
const SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE = CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE;

export const catalogRankPremiumSchema = z.object({
  origin: z.string().optional(),
  process: z.string().optional(),
  supplier: z.string().optional(),
  stocked: z.boolean().optional(),
  priceMax: z.number().optional(),
  minScore: z.number().optional(),
  includeUnscored: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(50).default(10).optional(),
  sampleSize: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE)
    .default(CATALOG_PREMIUM_DEFAULT_SAMPLE_SIZE)
    .optional(),
});

export type CatalogRankPremiumInput = z.input<typeof catalogRankPremiumSchema>;

export const supplierAggregateSchema = z.object({
  supplier: z.string().optional(),
  country: z.string().optional(),
  stocked: z.boolean().optional(),
  nonWholesaleOnly: z.boolean().default(false).optional(),
  minCoffees: z.number().int().min(1).default(1).optional(),
  topCoffees: z.number().int().min(1).max(25).default(5).optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
  sampleSize: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE)
    .default(SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE)
    .optional(),
});

export type SupplierAggregateInput = z.input<typeof supplierAggregateSchema>;

export const catalogFacetFields = [
  'supplier',
  'country',
  'processing_base_method',
  'fermentation_type',
  'drying_method',
  'grade',
  'wholesale',
] as const;

export const catalogFacetsSchema = z.object({
  field: z.enum(catalogFacetFields),
  stockedOnly: z.boolean().default(true).optional(),
  limit: z.number().int().min(1).max(100).default(60).optional(),
  sampleSize: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE)
    .default(SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE)
    .optional(),
});

export type CatalogFacetsInput = z.input<typeof catalogFacetsSchema>;

export const catalogRankObjectives = ['premium', 'value', 'fresh_arrival', 'rare_origin'] as const;

export const catalogRankSchema = z.object({
  objective: z.enum(catalogRankObjectives).default('premium').optional(),
  stockedOnly: z.boolean().default(true).optional(),
  supplier: z.string().optional(),
  country: z.string().optional(),
  process: z.string().optional(),
  priceMax: z.number().optional(),
  minScore: z.number().optional(),
  nonWholesaleOnly: z.boolean().default(false).optional(),
  limit: z.number().int().min(1).max(50).default(10).optional(),
  sampleSize: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_INTELLIGENCE_MAX_SAMPLE_SIZE)
    .default(SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE)
    .optional(),
});

export type CatalogRankInput = z.input<typeof catalogRankSchema>;

export const catalogSimilarityModes = ['all', 'likely_same', 'similar_profile'] as const;

export const getCatalogSimilaritySchema = z.object({
  coffee_id: z
    .number()
    .int()
    .positive()
    .describe('The coffee_catalog ID to request canonical similarity for'),
  threshold: z
    .number()
    .min(0.5)
    .max(0.99)
    .default(0.7)
    .optional()
    .describe('Minimum canonical similarity threshold (0.5-0.99)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .optional()
    .describe('Maximum canonical similarity results to request'),
  stockedOnly: z
    .boolean()
    .default(false)
    .optional()
    .describe('Restrict similarity results to currently stocked coffees'),
  mode: z.enum(catalogSimilarityModes).default('all').optional().describe('Canonical group filter'),
});

export type GetCatalogSimilarityInput = z.input<typeof getCatalogSimilaritySchema>;

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

function round(value: number, places = 2): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function uniqueSorted(values: Array<string | null | undefined>, limit = 10): string[] {
  return [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

export function summarizePurveyorScore(
  scoreValueOrItem: number | null | undefined | Partial<CatalogItem>
): PurveyorScoreSummary {
  const item =
    typeof scoreValueOrItem === 'object' && scoreValueOrItem !== null
      ? scoreValueOrItem
      : undefined;
  const value: number | null = item
    ? (item.purveyor_score ?? null)
    : typeof scoreValueOrItem === 'number'
      ? scoreValueOrItem
      : null;
  const base = {
    source: 'purveyor_score' as const,
    confidence: item?.purveyor_score_confidence ?? null,
    tier: item?.purveyor_score_tier ?? null,
    factors: item?.purveyor_score_factors ?? null,
    version: item?.purveyor_score_version ?? null,
    updated_at: item?.purveyor_score_updated_at ?? null,
  };

  if (value === null) {
    return {
      value: null,
      band: 'unscored',
      ...base,
      note: 'No Purveyor Score is available on this catalog row.',
    };
  }

  if (value >= 90) {
    return {
      value,
      band: 'premium',
      ...base,
      note: 'High Purveyor Score; inspect confidence and factor breakdown before treating it as a premium catalog candidate.',
    };
  }

  if (value >= 85) {
    return {
      value,
      band: 'strong',
      ...base,
      note: 'Strong Purveyor Score; compare confidence, factor breakdown, price, provenance, and fit before selecting.',
    };
  }

  return {
    value,
    band: 'scored',
    ...base,
    note: 'Purveyor Score is available; ranking still depends on confidence, factor breakdown, and sourcing context.',
  };
}

function getPurveyorScoreValue(item: Pick<CatalogItem, 'purveyor_score'>): number | null {
  return item.purveyor_score ?? null;
}

function buildRankSignals(item: CatalogItem): string[] {
  const signals: string[] = [];
  const score = summarizePurveyorScore(item);
  if (score.value !== null) signals.push(`purveyor_score=${score.value}`);
  if (score.confidence !== null) signals.push(`purveyor_score_confidence=${score.confidence}`);
  if (score.tier) signals.push(`purveyor_score_tier=${score.tier}`);
  const price = getPerLbPrice(item);
  if (price !== null) signals.push(`price_per_lb=${price}`);
  if (item.stocked === true) signals.push('currently_stocked');
  if (item.country) signals.push(`origin=${item.country}`);
  if (item.processing_base_method ?? item.processing) {
    signals.push(`process=${item.processing_base_method ?? item.processing}`);
  }
  return signals;
}

function toPremiumRankedItem(item: CatalogItem, rank: number): CatalogPremiumRankedItem {
  return {
    rank,
    id: item.id,
    name: item.name,
    supplier: item.source,
    origin: {
      continent: item.continent,
      country: item.country,
      region: item.region,
    },
    processing: {
      label: item.processing,
      base_method: item.processing_base_method,
      fermentation_type: item.fermentation_type,
      drying_method: item.drying_method,
    },
    purveyor_score: summarizePurveyorScore(item),
    pricing: {
      price_per_lb: item.price_per_lb,
      cost_lb: item.cost_lb,
      price_tiers: item.price_tiers,
    },
    stocked: item.stocked,
    stocked_date: item.stocked_date,
    signals: buildRankSignals(item),
  };
}

export function computeCatalogPremiumRanking(
  items: CatalogItem[],
  opts: { limit?: number; includeUnscored?: boolean; minScore?: number } = {}
): CatalogPremiumRankedItem[] {
  const limit = opts.limit ?? 10;
  const includeUnscored = opts.includeUnscored ?? false;
  const minScore = opts.minScore;

  return items
    .filter((item) => includeUnscored || getPurveyorScoreValue(item) !== null)
    .filter(
      (item) => minScore === undefined || (getPurveyorScoreValue(item) ?? -Infinity) >= minScore
    )
    .sort((a, b) => {
      const scoreDelta =
        (getPurveyorScoreValue(b) ?? -Infinity) - (getPurveyorScoreValue(a) ?? -Infinity);
      if (scoreDelta !== 0) return scoreDelta;

      const aPrice = getPerLbPrice(a) ?? Infinity;
      const bPrice = getPerLbPrice(b) ?? Infinity;
      if (aPrice !== bPrice) return aPrice - bPrice;

      return (a.name ?? '').localeCompare(b.name ?? '');
    })
    .slice(0, limit)
    .map((item, index) => toPremiumRankedItem(item, index + 1));
}

export function computeSupplierAggregates(
  items: CatalogItem[],
  opts: { topCoffees?: number; minCoffees?: number } = {}
): SupplierAggregate[] {
  const bySupplier = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const supplier = item.source?.trim() || 'Unknown supplier';
    const group = bySupplier.get(supplier) ?? [];
    group.push(item);
    bySupplier.set(supplier, group);
  }

  const topCoffees = opts.topCoffees ?? 5;
  const minCoffees = opts.minCoffees ?? 1;

  return [...bySupplier.entries()]
    .map(([supplier, supplierItems]) => {
      const scores = supplierItems
        .map((item) => getPurveyorScoreValue(item))
        .filter((score): score is number => score !== null);
      const confidences = supplierItems
        .map((item) => item.purveyor_score_confidence)
        .filter((confidence): confidence is number => confidence !== null);
      const prices = supplierItems
        .map((item) => getPerLbPrice(item))
        .filter((p): p is number => p !== null);

      return {
        supplier,
        total: supplierItems.length,
        stocked: supplierItems.filter((item) => item.stocked === true).length,
        score: {
          average: average(scores),
          coverage: supplierItems.length === 0 ? 0 : round(scores.length / supplierItems.length, 3),
          scored_count: scores.length,
          top_score: scores.length > 0 ? Math.max(...scores) : null,
          average_confidence: average(confidences),
          confidence_coverage:
            supplierItems.length === 0 ? 0 : round(confidences.length / supplierItems.length, 3),
        },
        price: {
          average_per_lb: average(prices),
          min_per_lb: prices.length > 0 ? Math.min(...prices) : null,
          max_per_lb: prices.length > 0 ? Math.max(...prices) : null,
        },
        origins: uniqueSorted(supplierItems.flatMap((item) => [item.country, item.continent])),
        processing_methods: uniqueSorted(
          supplierItems.map((item) => item.processing_base_method ?? item.processing)
        ),
        top_coffees: computeCatalogPremiumRanking(supplierItems, {
          limit: topCoffees,
          includeUnscored: true,
        }),
      } satisfies SupplierAggregate;
    })
    .filter((supplier) => supplier.total >= minCoffees)
    .sort((a, b) => {
      const scoreDelta = (b.score.average ?? -Infinity) - (a.score.average ?? -Infinity);
      if (scoreDelta !== 0) return scoreDelta;
      const stockedDelta = b.stocked - a.stocked;
      if (stockedDelta !== 0) return stockedDelta;
      return a.supplier.localeCompare(b.supplier);
    });
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

  const url = new URL('/v1/catalog', getParchmentBaseUrl());
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

async function parseCatalogApiError(
  response: Response,
  context = 'include=proof'
): Promise<PrvrsError> {
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
      `Catalog API rejected ${context}: ${serverMessage}. Verify the configured Purveyors API endpoint supports this canonical catalog contract.`,
      details
    );
  }

  if (response.status === 404) {
    if (context === '/v1/catalog/{id}/similar') {
      if (/^Catalog coffee \d+ was not found$/i.test(serverMessage)) {
        return new PrvrsError(
          'NOT_FOUND',
          `Catalog similarity target not found: ${serverMessage}`,
          details
        );
      }

      return new PrvrsError(
        'CONFIG_ERROR',
        `Catalog similarity API endpoint not found. Set PURVEYORS_BASE_URL to a Purveyors deployment that supports ${context}.`,
        details
      );
    }

    return new PrvrsError(
      'CONFIG_ERROR',
      `Catalog API endpoint not found. Set PURVEYORS_BASE_URL to a Purveyors deployment that supports ${context}.`,
      details
    );
  }

  return new PrvrsError(
    'GENERAL_ERROR',
    `Catalog API request failed (${response.status}): ${serverMessage}`,
    details
  );
}

function buildCatalogSimilarityApiUrl(parsed: z.infer<typeof getCatalogSimilaritySchema>): URL {
  const url = new URL(`/v1/catalog/${parsed.coffee_id}/similar`, getParchmentBaseUrl());
  const params = url.searchParams;
  params.set('threshold', String(parsed.threshold ?? 0.7));
  params.set('limit', String(parsed.limit ?? 10));
  params.set('stocked_only', String(parsed.stockedOnly ?? false));
  if ((parsed.mode ?? 'all') !== 'all') {
    params.set('mode', parsed.mode ?? 'all');
  }
  return url;
}

function isCatalogSimilarityResponse(value: unknown): value is CatalogSimilarityResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const data = record.data as Record<string, unknown> | undefined;
  const groups = data?.groups as Record<string, unknown> | undefined;
  const meta = record.meta as Record<string, unknown> | undefined;
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.target &&
    groups &&
    Array.isArray(groups.canonical_candidates) &&
    Array.isArray(groups.similar_recommendations) &&
    meta &&
    typeof meta.classification_version === 'string' &&
    typeof meta.query_strategy === 'string'
  );
}

async function fetchCatalogSimilarityApi(
  parsed: z.infer<typeof getCatalogSimilaritySchema>
): Promise<CatalogSimilarityResponse> {
  const url = buildCatalogSimilarityApiUrl(parsed);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${await resolveParchmentToken('member')}`,
    },
  });

  if (!response.ok) {
    throw await parseCatalogApiError(response, '/v1/catalog/{id}/similar');
  }

  const envelope = (await response.json()) as unknown;
  if (!isCatalogSimilarityResponse(envelope)) {
    throw new PrvrsError(
      'GENERAL_ERROR',
      'Catalog similarity API returned an unexpected response shape; expected canonical { data: { target, groups: { canonical_candidates, similar_recommendations } }, meta }.',
      { body: envelope }
    );
  }

  return envelope;
}

async function fetchCatalogApiItems(
  parsed: z.infer<typeof searchCatalogSchema>
): Promise<CatalogItem[]> {
  const url = buildCatalogApiUrl(parsed);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${await resolveParchmentToken(
        parsed.processingBaseMethod ||
          parsed.fermentationType ||
          parsed.processAdditive ||
          parsed.processingDisclosureLevel ||
          parsed.processingConfidenceMin !== undefined
          ? 'member'
          : 'viewer'
      )}`,
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
export async function searchCatalog(opts: SearchCatalogInput): Promise<CatalogItem[]> {
  const parsed = searchCatalogSchema.parse(opts);

  if (parsed.includeProof) {
    return fetchCatalogApiItems(parsed);
  }
  const offset = parsed.offset ?? 0;
  if (!hasCatalogIdFilter(parsed) && offset % parsed.limit !== 0) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Canonical catalog pagination requires --offset to be a multiple of --limit. Received offset=${offset}, limit=${parsed.limit}.`
    );
  }

  const sort = parsed.sort ? CATALOG_API_SORT_MAP[parsed.sort] : undefined;
  const client = await createParchmentClient(
    parsed.processingBaseMethod ||
      parsed.fermentationType ||
      parsed.processAdditive ||
      parsed.processingDisclosureLevel ||
      parsed.processingConfidenceMin !== undefined
      ? 'member'
      : 'viewer'
  );
  const result = await client.catalog.list({
    origin: parsed.origin,
    processing: parsed.process,
    processing_base_method: parsed.processingBaseMethod,
    fermentation_type: parsed.fermentationType,
    process_additive: parsed.processAdditive,
    processing_disclosure_level: parsed.processingDisclosureLevel,
    processing_confidence_min: parsed.processingConfidenceMin,
    pricePerLbMin: parsed.priceMin,
    pricePerLbMax: parsed.priceMax,
    flavorKeywords: parsed.flavor
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    name: parsed.name,
    supplier: parsed.supplier,
    coffeeIds: parsed.ids?.join(','),
    variety: parsed.variety,
    dryingMethod: parsed.dryingMethod,
    stockedDays: parsed.stockedDays,
    stocked: parsed.stocked ? 'true' : 'all',
    sort: sort?.field,
    order: sort?.direction,
    limit: hasCatalogIdFilter(parsed) ? Math.min(parsed.ids?.length ?? 1, 100) : parsed.limit,
    page: hasCatalogIdFilter(parsed) ? 1 : Math.floor(offset / parsed.limit) + 1,
  });
  const envelope = unwrapParchment(result, 'Catalog search');
  return envelope.data as CatalogItem[];
}

/**
 * Fetch a single catalog item by ID.
 */
export async function getCatalog(
  id: number,
  opts: { includeProof?: boolean } = {}
): Promise<CatalogItem> {
  const parsed = getCatalogSchema.parse({ id, includeProof: opts.includeProof });

  if (parsed.includeProof) {
    const rows = await fetchCatalogApiItems({
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

  const rows = await searchCatalog({ ids: [parsed.id], limit: 1 });
  const item = rows[0];
  if (!item) {
    throw new PrvrsError('NOT_FOUND', `Coffee ID ${parsed.id} not found in catalog.`);
  }
  return item;
}

/**
 * Fetch aggregate statistics for the coffee catalog.
 */
export async function getCatalogStats(): Promise<CatalogStats> {
  const client = await createParchmentClient('viewer');
  const envelope = unwrapParchment(await client.catalog.stats({ stocked: 'all' }), 'Catalog stats');
  return envelope.stats;
}

function buildCatalogIntelligenceQuery(
  supabase: SupabaseClient,
  parsed: {
    origin?: string;
    process?: string;
    supplier?: string;
    country?: string;
    stocked?: boolean;
    nonWholesaleOnly?: boolean;
    priceMax?: number;
    minScore?: number;
    sampleSize?: number;
    orderByScore?: boolean;
  },
  options: { applyRange?: boolean } = {}
) {
  let query = supabase.from('coffee_catalog').select('*');

  if (parsed.origin) {
    const origin = sanitizeFilterValue(parsed.origin);
    query = query.or(
      `country.ilike.%${origin}%,continent.ilike.%${origin}%,region.ilike.%${origin}%`
    );
  }

  if (parsed.process) {
    const process = sanitizeFilterValue(parsed.process);
    query = query.or(`processing.ilike.%${process}%,processing_base_method.ilike.%${process}%`);
  }

  if (parsed.supplier) {
    query = query.ilike('source', `%${sanitizeFilterValue(parsed.supplier)}%`);
  }

  if (parsed.country) {
    query = query.ilike('country', `%${sanitizeFilterValue(parsed.country)}%`);
  }

  if (parsed.stocked !== undefined) {
    query = query.eq('stocked', parsed.stocked);
  }

  if (parsed.priceMax !== undefined) {
    query = query.lte('price_per_lb', parsed.priceMax);
  }

  if (parsed.minScore !== undefined) {
    query = query.gte('purveyor_score', parsed.minScore);
  }

  if (parsed.nonWholesaleOnly) {
    query = query.or('wholesale.is.null,wholesale.eq.false');
  }

  if (parsed.orderByScore) {
    query = query.order('purveyor_score', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('source', { ascending: true, nullsFirst: false });
  }

  if (options.applyRange ?? true) {
    const sampleSize = parsed.sampleSize ?? CATALOG_PREMIUM_DEFAULT_SAMPLE_SIZE;
    query = query.range(0, sampleSize - 1);
  }

  return query;
}

async function fetchSupplierAggregateRows(
  supabase: SupabaseClient,
  parsed: Pick<
    SupplierAggregateInput,
    'supplier' | 'country' | 'stocked' | 'nonWholesaleOnly' | 'sampleSize'
  >
): Promise<CatalogItem[]> {
  const sampleSize = parsed.sampleSize ?? SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE;
  const pageSize = Math.min(sampleSize, SUPABASE_DATA_API_MAX_PAGE_SIZE);
  const rows: CatalogItem[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildCatalogIntelligenceQuery(
      supabase,
      {
        supplier: parsed.supplier,
        country: parsed.country,
        stocked: parsed.stocked,
        nonWholesaleOnly: parsed.nonWholesaleOnly,
      },
      { applyRange: false }
    )
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as unknown as CatalogItem[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchCatalogPremiumSampleRows(
  supabase: SupabaseClient,
  parsed: CatalogRankPremiumInput,
  sampleSize: number
): Promise<{ sampledRows: CatalogItem[]; truncated: boolean }> {
  const targetRows = sampleSize + 1;
  const pageSize = Math.min(targetRows, SUPABASE_DATA_API_MAX_PAGE_SIZE);
  const rows: CatalogItem[] = [];

  for (let offset = 0; rows.length < targetRows; offset += pageSize) {
    const pageEnd = Math.min(offset + pageSize - 1, targetRows - 1);
    const { data, error } = await buildCatalogIntelligenceQuery(
      supabase,
      {
        ...parsed,
        orderByScore: true,
      },
      { applyRange: false }
    )
      .order('id', { ascending: true })
      .range(offset, pageEnd);

    if (error) throw error;

    const page = (data ?? []) as unknown as CatalogItem[];
    rows.push(...page);

    if (page.length < pageEnd - offset + 1) break;
  }

  return {
    sampledRows: rows.slice(0, sampleSize),
    truncated: rows.length > sampleSize,
  };
}

const catalogIntelligenceCaveats = [
  'Purveyor Score is read from coffee_catalog.purveyor_score with confidence, tier, factor breakdown, version, and update metadata; the CLI does not recompute the upstream score model.',
  'Ranking is catalog-only and does not account for a roaster’s owned inventory, roast history, or target menu fit.',
];

const catalogPremiumRankingCaveats = [
  ...catalogIntelligenceCaveats,
  'Premium ranking samples catalog rows ordered by purveyor_score descending, then id ascending, before applying agent-facing ranking logic; meta.truncated indicates more rows matched than the requested sample_size.',
];

const supplierAggregateCaveats = [
  ...catalogIntelligenceCaveats,
  'Supplier aggregates paginate catalog rows ordered by source ascending, then id ascending; meta.sample_size is the requested fetch page size and meta.rows_examined reports the rows included in aggregation.',
];

const catalogFacetColumns: Record<CatalogFacetField, keyof CatalogItem> = {
  supplier: 'source',
  country: 'country',
  processing_base_method: 'processing_base_method',
  fermentation_type: 'fermentation_type',
  drying_method: 'drying_method',
  grade: 'grade',
  wholesale: 'wholesale',
};

const catalogFacetCaveats = [
  'Facet counts are computed from catalog rows visible to the current client and are intended for value discovery, not inventory guarantees.',
];

const catalogRankingCaveats = [
  ...catalogIntelligenceCaveats,
  'Generic catalog ranking samples catalog rows ordered by id ascending before applying deterministic objective-specific ranking; meta.truncated indicates more rows matched than the requested sample_size.',
];

function asPositiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function scoreBasis(item: CatalogItem): string {
  const score = summarizePurveyorScore(item);
  if (score.value === null) return 'no Purveyor Score yet';
  const tier = score.tier ? `, ${score.tier}` : '';
  return `Purveyor Score ${score.value}${tier}`;
}

async function fetchCatalogFacetRows(
  supabase: SupabaseClient,
  parsed: z.output<typeof catalogFacetsSchema>
): Promise<{ rows: CatalogItem[]; truncated: boolean }> {
  const sampleSize = parsed.sampleSize ?? SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE;
  const targetRows = sampleSize + 1;
  const pageSize = Math.min(targetRows, SUPABASE_DATA_API_MAX_PAGE_SIZE);
  const rows: CatalogItem[] = [];
  const column = catalogFacetColumns[parsed.field];

  for (let offset = 0; rows.length < targetRows; offset += pageSize) {
    const pageEnd = Math.min(offset + pageSize - 1, targetRows - 1);
    let query = supabase.from('coffee_catalog').select(`id, ${String(column)}`);
    if (parsed.stockedOnly ?? true) query = query.eq('stocked', true);

    const { data, error } = await query.order('id', { ascending: true }).range(offset, pageEnd);
    if (error) throw error;

    const page = (data ?? []) as unknown as CatalogItem[];
    rows.push(...page);
    if (page.length < pageEnd - offset + 1) break;
  }

  return { rows: rows.slice(0, sampleSize), truncated: rows.length > sampleSize };
}

async function fetchCatalogRankRows(
  supabase: SupabaseClient,
  parsed: z.output<typeof catalogRankSchema>
): Promise<{ rows: CatalogItem[]; truncated: boolean }> {
  const sampleSize = parsed.sampleSize ?? SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE;
  const targetRows = sampleSize + 1;
  const pageSize = Math.min(targetRows, SUPABASE_DATA_API_MAX_PAGE_SIZE);
  const rows: CatalogItem[] = [];

  for (let offset = 0; rows.length < targetRows; offset += pageSize) {
    const pageEnd = Math.min(offset + pageSize - 1, targetRows - 1);
    let query = supabase.from('coffee_catalog').select('*');
    if (parsed.stockedOnly ?? true) query = query.eq('stocked', true);
    if (parsed.supplier) query = query.ilike('source', `%${sanitizeFilterValue(parsed.supplier)}%`);
    if (parsed.country) query = query.ilike('country', `%${sanitizeFilterValue(parsed.country)}%`);
    if (parsed.process) {
      const process = sanitizeFilterValue(parsed.process);
      query = query.or(`processing.ilike.%${process}%,processing_base_method.ilike.%${process}%`);
    }
    if (parsed.priceMax !== undefined) query = query.lte('price_per_lb', parsed.priceMax);
    if (parsed.minScore !== undefined) query = query.gte('purveyor_score', parsed.minScore);
    if (parsed.nonWholesaleOnly) query = query.or('wholesale.is.null,wholesale.eq.false');

    const { data, error } = await query.order('id', { ascending: true }).range(offset, pageEnd);
    if (error) throw error;

    const page = (data ?? []) as unknown as CatalogItem[];
    rows.push(...page);
    if (page.length < pageEnd - offset + 1) break;
  }

  return { rows: rows.slice(0, sampleSize), truncated: rows.length > sampleSize };
}

function rankCatalogRows(
  rows: CatalogItem[],
  objective: CatalogRankObjective,
  limit: number
): CatalogRankedItem[] {
  const byScoreDesc = (a: CatalogItem, b: CatalogItem) =>
    (getPurveyorScoreValue(b) ?? -Infinity) - (getPurveyorScoreValue(a) ?? -Infinity) ||
    String(b.stocked_date ?? '').localeCompare(String(a.stocked_date ?? '')) ||
    a.id - b.id;

  let ranked: Array<{ row: CatalogItem; basis: string }>;

  switch (objective) {
    case 'premium':
      ranked = [...rows].sort(byScoreDesc).map((row) => ({ row, basis: scoreBasis(row) }));
      break;
    case 'value': {
      ranked = rows
        .map((row) => {
          const score = getPurveyorScoreValue(row);
          const price = asPositiveNumber(getPerLbPrice(row));
          if (score === null || price === null) return null;
          return { row, ratio: score / price };
        })
        .filter((entry): entry is { row: CatalogItem; ratio: number } => entry !== null)
        .sort((a, b) => b.ratio - a.ratio || byScoreDesc(a.row, b.row))
        .map(({ row, ratio }) => ({
          row,
          basis: `${scoreBasis(row)} at $${getPerLbPrice(row)}/lb (${round(ratio, 1)} score points per dollar)`,
        }));
      break;
    }
    case 'fresh_arrival':
      ranked = [...rows]
        .sort(
          (a, b) =>
            String(b.stocked_date ?? '').localeCompare(String(a.stocked_date ?? '')) ||
            String(b.arrival_date ?? '').localeCompare(String(a.arrival_date ?? '')) ||
            byScoreDesc(a, b)
        )
        .map((row) => ({
          row,
          basis: `stocked ${row.stocked_date ?? 'date unknown'}; ${scoreBasis(row)}`,
        }));
      break;
    case 'rare_origin': {
      const originCounts = new Map<string, number>();
      for (const row of rows) {
        const country = row.country?.trim();
        if (country) originCounts.set(country, (originCounts.get(country) ?? 0) + 1);
      }
      const rarity = (row: CatalogItem) => {
        const country = row.country?.trim();
        return country
          ? (originCounts.get(country) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      };
      ranked = [...rows]
        .filter((row) => Boolean(row.country?.trim()))
        .sort((a, b) => rarity(a) - rarity(b) || byScoreDesc(a, b))
        .map((row) => ({
          row,
          basis: `${row.country} has ${rarity(row)} matching listing(s); ${scoreBasis(row)}`,
        }));
      break;
    }
  }

  return ranked.slice(0, limit).map(({ row, basis }, index) => ({
    ...row,
    rank: index + 1,
    rank_basis: basis,
  }));
}

/** List distinct catalog facet values with counts for agent/client filter discovery. */
export async function listCatalogFacets(input: CatalogFacetsInput): Promise<CatalogFacetsResponse> {
  const parsed = catalogFacetsSchema.parse(input);
  const limit = parsed.limit ?? 60;
  const column = catalogFacetColumns[parsed.field];
  const facetKey = {
    supplier: 'sources',
    country: 'countries',
    processing_base_method: 'processing_base_method',
    fermentation_type: 'fermentation_type',
    drying_method: 'drying_method',
    grade: 'grade',
    wholesale: 'wholesale',
  }[parsed.field];
  const client = await createParchmentClient('viewer');
  const envelope = unwrapParchment(
    await client.catalog.facets({ stocked: parsed.stockedOnly === false ? 'all' : 'true' }),
    'Catalog facets'
  );
  const facets = envelope.facets as Record<string, CatalogFacetValue[] | undefined>;
  const values = (facets[facetKey] ?? []).slice(0, limit);
  const rowsExamined = (facets[facetKey] ?? []).reduce((total, facet) => total + facet.count, 0);

  return {
    data: values,
    meta: {
      resource: 'catalog-facets',
      field: parsed.field,
      source_column: String(column),
      stocked_only: parsed.stockedOnly ?? true,
      scope: (parsed.stockedOnly ?? true) ? 'stocked_only' : 'all_visible',
      sample_size: rowsExamined,
      sample_limited: false,
      sample_order: 'id_asc',
      truncated: (facets[facetKey]?.length ?? 0) > limit,
      rows_examined: rowsExamined,
      distinct_values: facets[facetKey]?.length ?? 0,
      returned: values.length,
      caveats: catalogFacetCaveats,
    },
  };
}

/** Rank catalog candidates by deterministic product-intelligence objectives. */
export async function rankCatalog(input: CatalogRankInput = {}): Promise<CatalogRankingResponse> {
  const parsed = catalogRankSchema.parse(input);
  const client = await createParchmentClient('viewer');
  const envelope = unwrapParchment(
    await client.catalog.rank({
      objective: parsed.objective,
      stockedOnly: parsed.stockedOnly === false ? 'false' : 'true',
      supplier: parsed.supplier,
      country: parsed.country,
      process: parsed.process,
      priceMax: parsed.priceMax,
      minScore: parsed.minScore,
      nonWholesaleOnly: parsed.nonWholesaleOnly ? 'true' : 'false',
      limit: parsed.limit,
      sampleSize: parsed.sampleSize,
    }),
    'Catalog ranking'
  );
  return envelope as unknown as CatalogRankingResponse;
}

/**
 * Rank premium catalog candidates by Purveyor Score, with pricing and sourcing signals.
 */
export async function catalogRankPremium(
  supabase: SupabaseClient,
  input: CatalogRankPremiumInput = {}
): Promise<CatalogPremiumRanking> {
  const parsed = catalogRankPremiumSchema.parse(input);
  const sampleSize = parsed.sampleSize ?? CATALOG_PREMIUM_DEFAULT_SAMPLE_SIZE;
  const { sampledRows, truncated } = await fetchCatalogPremiumSampleRows(
    supabase,
    parsed,
    sampleSize
  );

  const ranking = computeCatalogPremiumRanking(sampledRows, {
    limit: parsed.limit ?? 10,
    includeUnscored: parsed.includeUnscored ?? false,
    minScore: parsed.minScore,
  });

  return {
    data: ranking,
    meta: {
      resource: 'catalog-premium-ranking',
      scoring_source: 'coffee_catalog.purveyor_score',
      sample_size: sampleSize,
      sample_limited: true,
      sample_order: 'purveyor_score_desc_nulls_last',
      truncated,
      returned: ranking.length,
      filters: {
        origin: parsed.origin,
        process: parsed.process,
        supplier: parsed.supplier,
        stocked: parsed.stocked,
        priceMax: parsed.priceMax,
        minScore: parsed.minScore,
        includeUnscored: parsed.includeUnscored ?? false,
      },
      caveats: catalogPremiumRankingCaveats,
    },
  };
}

async function getSupplierAggregates(
  supabase: SupabaseClient,
  input: SupplierAggregateInput,
  resource: SupplierAggregateResponse['meta']['resource']
): Promise<SupplierAggregateResponse> {
  const parsed = supplierAggregateSchema.parse(input);
  const sampleSize = parsed.sampleSize ?? SUPPLIER_AGGREGATE_DEFAULT_SAMPLE_SIZE;
  const rows = await fetchSupplierAggregateRows(supabase, {
    supplier: parsed.supplier,
    country: parsed.country,
    stocked: parsed.stocked,
    nonWholesaleOnly: parsed.nonWholesaleOnly,
    sampleSize,
  });

  const aggregates = computeSupplierAggregates(rows, {
    topCoffees: parsed.topCoffees ?? 5,
    minCoffees: parsed.minCoffees ?? 1,
  }).slice(0, parsed.limit ?? 25);

  return {
    data: aggregates,
    meta: {
      resource,
      sample_size: sampleSize,
      sample_limited: false,
      sample_order: 'source_asc_nulls_last',
      truncated: false,
      rows_examined: rows.length,
      returned: aggregates.length,
      filters: {
        supplier: parsed.supplier,
        country: parsed.country,
        stocked: parsed.stocked,
        minCoffees: parsed.minCoffees ?? 1,
        nonWholesaleOnly: parsed.nonWholesaleOnly ?? false,
      },
      caveats: supplierAggregateCaveats,
    },
  };
}

/** List supplier aggregates from catalog rows. */
export async function supplierList(
  supabase: SupabaseClient,
  input: SupplierAggregateInput = {}
): Promise<SupplierAggregateResponse> {
  return getSupplierAggregates(supabase, input, 'supplier-list');
}

/** Return aggregate detail for a supplier query. */
export async function supplierDetail(
  supabase: SupabaseClient,
  input: SupplierAggregateInput
): Promise<SupplierAggregateResponse> {
  const parsed = supplierAggregateSchema.parse(input);
  if (!parsed.supplier?.trim()) {
    throw new PrvrsError('INVALID_ARGUMENT', 'supplierDetail requires a non-empty supplier name.');
  }
  return getSupplierAggregates(
    supabase,
    { ...parsed, limit: parsed.limit ?? 10 },
    'supplier-detail'
  );
}

/** Rank suppliers by average Purveyor Score, then currently stocked coverage. */
export async function supplierRank(
  supabase: SupabaseClient,
  input: SupplierAggregateInput = {}
): Promise<SupplierAggregateResponse> {
  return getSupplierAggregates(supabase, input, 'supplier-rank');
}

/**
 * Fetch canonical catalog similarity groups from the beta /v1/catalog/{id}/similar API.
 */
export async function getCatalogSimilarity(
  input: GetCatalogSimilarityInput
): Promise<CatalogSimilarityResponse> {
  const parsed = getCatalogSimilaritySchema.parse(input);
  return fetchCatalogSimilarityApi(parsed);
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
