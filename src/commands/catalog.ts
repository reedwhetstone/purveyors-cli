import { Command } from 'commander';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import {
  searchCatalog,
  getCatalog,
  getCatalogStats,
  getCatalogSimilarity,
  computeCatalogStats,
  sanitizeFilterValue,
  catalogSortFields,
  catalogSimilarityModes,
} from '../lib/catalog.js';
import type { CatalogItem, CatalogStats, CatalogSortField } from '../lib/catalog.js';
import type { OutputOptions } from '../types/index.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export types and helpers for backwards compatibility
export type { CatalogItem, CatalogStats };
export { sanitizeFilterValue, computeCatalogStats };

function hasCatalogApiKeyEnv(): boolean {
  return Boolean(process.env.PARCHMENT_API_KEY || process.env.PURVEYORS_API_KEY);
}

function createApiKeyOnlyCatalogClient(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  } as unknown as SupabaseClient;
}

async function resolveCatalogReadClient(
  requiredRole: 'viewer' | 'member',
  useApiKeyWithoutSession: boolean
): Promise<SupabaseClient> {
  if (useApiKeyWithoutSession && hasCatalogApiKeyEnv()) {
    return createApiKeyOnlyCatalogClient();
  }

  const { supabase } = await requireAuth(requiredRole);
  return supabase;
}

function parseFiniteNumberArg(rawValue: string, message: string): number {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  return parsed;
}

function parsePositiveIntegerArg(rawValue: string, message: string): number {
  const parsed = parseFiniteNumberArg(rawValue, message);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  return parsed;
}

function parseNonNegativeIntegerArg(rawValue: string, message: string): number {
  const parsed = parseFiniteNumberArg(rawValue, message);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  return parsed;
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey catalog` — Browse the coffee catalog.
 * Requires an authenticated viewer session. Structured process filters on
 * `catalog search` require member access under the current session-authenticated
 * CLI path.
 */
export function buildCatalogCommand(): Command {
  const catalog = new Command('catalog').description('Browse the coffee catalog');

  // ── catalog search ────────────────────────────────────────────────────────
  catalog
    .command('search')
    .description('Search coffees by origin, process, price, or flavor')
    .option('--origin <origin>', 'Filter by origin (country, continent, or region)')
    .option('--process <method>', 'Filter by processing method (e.g. natural, washed)')
    .option('--processing-base-method <method>', 'Filter by canonical process base method')
    .option('--fermentation-type <type>', 'Filter by structured fermentation type')
    .option('--process-additive <additive>', 'Filter by disclosed process additive')
    .option('--processing-disclosure-level <level>', 'Filter by process disclosure level')
    .option('--processing-confidence-min <n>', 'Minimum process metadata confidence (0-1)')
    .option('--price-min <n>', 'Minimum price per lb (USD)')
    .option('--price-max <n>', 'Maximum price per lb (USD)')
    .option('--flavor <keywords>', 'Flavor keywords, comma-separated (e.g. "berry,chocolate")')
    .option('--name <text>', 'Filter by coffee name (partial match, case-insensitive)')
    .option('--supplier <name>', 'Filter by supplier/source name (partial match, case-insensitive)')
    .option('--ids <n,n,...>', 'Fetch specific catalog IDs (comma-separated, ignores limit)')
    .option('--variety <text>', 'Filter by coffee variety/cultivar (partial match)')
    .option('--drying-method <text>', 'Filter by drying method (partial match)')
    .option('--stocked-days <n>', 'Only show coffees stocked within N days')
    .option('--stocked', 'Only show currently stocked coffees')
    .option('--sort <field>', `Sort results by: ${catalogSortFields.join(', ')}`)
    .option('--offset <n>', 'Skip N results (for pagination)', '0')
    .option('--limit <n>', 'Maximum results to return', '10')
    .option('--include-proof', 'Request canonical catalog proof summaries from /v1/catalog')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog search --origin "Ethiopia" --pretty
  purvey catalog search --origin "Colombia" --process "honey" --pretty
  purvey catalog search --process "natural" --flavor "blueberry,citrus" --stocked
  purvey catalog search --processing-base-method "Natural" --fermentation-type "Anaerobic" --pretty
  purvey catalog search --process-additive "hops" --processing-confidence-min 0.8 --pretty
  purvey catalog search --price-min 5 --price-max 12 --stocked --limit 20
  purvey catalog search --stocked --sort price --pretty
  purvey catalog search --sort newest --limit 20
  purvey catalog search --stocked --limit 10 --offset 10   # page 2
  purvey catalog search --origin "Ethiopia" --csv > ethiopia.csv
  purvey catalog search --stocked --limit 50 | jq '.[].name'
  purvey catalog search --name "Guji" --pretty
  purvey catalog search --supplier "Royal Coffee" --stocked --pretty
  purvey catalog search --ids "1182,1183,1200"
  purvey catalog search --variety "gesha" --stocked --pretty
  purvey catalog search --drying-method "sun" --origin "Ethiopia" --pretty
  purvey catalog search --stocked-days 30 --pretty
  purvey catalog search --origin "Ethiopia" --include-proof --json

Sort fields:
  price       cheapest first
  price-desc  most expensive first
  name        alphabetical by name
  origin      alphabetical by country
  newest      most recently updated first

Notes:
  All filters are optional. Without flags, returns up to --limit results.
  --origin accepts partial matches (e.g. "Ethiopia" matches "Ethiopia Guji").
  Structured process filters map to canonical /v1/catalog query names.
  --process remains the legacy broad processing-label filter.
  --processing-base-method, --fermentation-type, --process-additive,
  --processing-disclosure-level, and --processing-confidence-min require member
  access under the current session-authenticated CLI path.
  --processing-base-method, --fermentation-type, --process-additive, and
  --processing-disclosure-level require exact structured metadata matches.
  --processing-confidence-min accepts a decimal from 0 to 1.
  --name and --supplier accept partial matches (case-insensitive).
  --variety filters on cultivar_detail (partial match, case-insensitive).
  --drying-method filters on drying_method (partial match, case-insensitive).
  --stocked-days N shows only coffees stocked within the last N days.
  --ids fetches specific catalog items by ID, ignoring --limit and --offset.
  --offset + --limit enables pagination through large result sets.
  --include-proof uses the canonical /v1/catalog?include=proof response and does
  not compute proof fields locally in the CLI.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        // Validate --sort if provided
        const sortValue = opts.sort as string | undefined;
        if (sortValue && !catalogSortFields.includes(sortValue as CatalogSortField)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --sort value: "${sortValue}". Must be one of: ${catalogSortFields.join(', ')}`
          );
        }

        // Parse --ids: comma-separated integers
        let parsedIds: number[] | undefined;
        if (opts.ids) {
          const raw = (opts.ids as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const nums: number[] = [];
          for (const token of raw) {
            nums.push(
              parsePositiveIntegerArg(
                token,
                `Invalid --ids value: "${token}". Each ID must be a positive integer.`
              )
            );
          }
          parsedIds = nums;
        }

        const priceMin =
          opts.priceMin !== undefined
            ? parseFiniteNumberArg(
                opts.priceMin as string,
                `Invalid --price-min: "${opts.priceMin}". Must be a number.`
              )
            : undefined;
        const priceMax =
          opts.priceMax !== undefined
            ? parseFiniteNumberArg(
                opts.priceMax as string,
                `Invalid --price-max: "${opts.priceMax}". Must be a number.`
              )
            : undefined;
        const stockedDays =
          opts.stockedDays !== undefined
            ? parsePositiveIntegerArg(
                opts.stockedDays as string,
                `Invalid --stocked-days: "${opts.stockedDays}". Must be a positive integer.`
              )
            : undefined;
        const processingConfidenceMin =
          opts.processingConfidenceMin !== undefined
            ? parseFiniteNumberArg(
                opts.processingConfidenceMin as string,
                `Invalid --processing-confidence-min: "${opts.processingConfidenceMin}". Must be a number from 0 to 1.`
              )
            : undefined;
        if (
          processingConfidenceMin !== undefined &&
          (processingConfidenceMin < 0 || processingConfidenceMin > 1)
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --processing-confidence-min: "${opts.processingConfidenceMin}". Must be a number from 0 to 1.`
          );
        }
        const offset =
          opts.offset !== undefined
            ? parseNonNegativeIntegerArg(
                opts.offset as string,
                `Invalid --offset: "${opts.offset}". Must be a non-negative integer.`
              )
            : undefined;
        const limit = parsePositiveIntegerArg(
          opts.limit as string,
          `Invalid --limit: "${opts.limit}". Must be a positive integer.`
        );

        const hasStructuredProcessFilters =
          opts.processingBaseMethod !== undefined ||
          opts.fermentationType !== undefined ||
          opts.processAdditive !== undefined ||
          opts.processingDisclosureLevel !== undefined ||
          opts.processingConfidenceMin !== undefined;
        const requiredRole = hasStructuredProcessFilters ? 'member' : 'viewer';
        const includeProof = opts.includeProof ? true : undefined;
        const supabase = await resolveCatalogReadClient(requiredRole, Boolean(includeProof));

        const data = await searchCatalog(supabase, {
          origin: opts.origin as string | undefined,
          process: opts.process as string | undefined,
          priceMin,
          priceMax,
          flavor: opts.flavor as string | undefined,
          name: opts.name as string | undefined,
          supplier: opts.supplier as string | undefined,
          ids: parsedIds,
          variety: opts.variety as string | undefined,
          dryingMethod: opts.dryingMethod as string | undefined,
          stockedDays,
          processingBaseMethod: opts.processingBaseMethod as string | undefined,
          fermentationType: opts.fermentationType as string | undefined,
          processAdditive: opts.processAdditive as string | undefined,
          processingDisclosureLevel: opts.processingDisclosureLevel as string | undefined,
          processingConfidenceMin,
          stocked: opts.stocked ? true : undefined,
          sort: sortValue as CatalogSortField | undefined,
          offset,
          limit,
          includeProof,
        });

        if (data.length === 0) {
          info('No coffees found matching your criteria.');
          return;
        }

        outputData(data, globalOpts);
      })
    );

  // ── catalog get <id> ──────────────────────────────────────────────────────
  catalog
    .command('get <id>')
    .description('Fetch a single coffee by ID')
    .option('--include-proof', 'Request the canonical catalog proof summary from /v1/catalog')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog get 128 --pretty
  purvey catalog get 128 --include-proof --json
  purvey catalog get 42 | jq '{name, origin, process, cost_lb}'
  purvey catalog get 77 --csv

Notes:
  <id> is the coffee_catalog.catalog_id (integer).
  Use 'purvey catalog search' to find IDs.
  --include-proof uses the canonical /v1/catalog?include=proof response and does
  not compute proof fields locally in the CLI.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const catalogId = parsePositiveIntegerArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`
        );

        const includeProof = opts.includeProof ? true : undefined;
        const supabase = await resolveCatalogReadClient('viewer', Boolean(includeProof));
        const data = await getCatalog(supabase, catalogId, {
          includeProof,
        });
        outputData(data, globalOpts);
      })
    );

  // ── catalog stats ─────────────────────────────────────────────────────────
  catalog
    .command('stats')
    .description('Aggregate statistics for the coffee catalog')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog stats --pretty
  purvey catalog stats | jq '.totalCoffees'
  purvey catalog stats --csv

Notes:
  Returns aggregated data: total count, average price, unique origins,
  processing method breakdown, and stocked count.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase } = await requireAuth('viewer');

        const stats = await getCatalogStats(supabase);
        outputData(stats, globalOpts);
      })
    );

  // ── catalog similar <id> ──────────────────────────────────────────────────
  catalog
    .command('similar <id>')
    .description('Find canonical candidates and similar recommendations for a catalog coffee')
    .option('--threshold <score>', 'Minimum canonical similarity threshold (0.5-0.99)', '0.70')
    .option('--limit <count>', 'Max results (1-25)', '10')
    .option('--stocked-only', 'Only show currently stocked beans')
    .option(
      '--mode <mode>',
      `Filter canonical groups by mode: ${catalogSimilarityModes.join(', ')}`,
      'all'
    )
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog similar 1182
  purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
  purvey catalog similar 1182 --mode likely_same --json | jq '.data.groups.canonical_candidates'
  purvey catalog similar 1182 --json | jq '.data.groups.similar_recommendations[0].match.classification.blockers'

Notes:
  Uses the beta canonical /v1/catalog/{id}/similar contract.
  JSON output is the canonical grouped response object, not the legacy flat RPC array.
  data.groups.canonical_candidates are likely same-lot candidates.
  data.groups.similar_recommendations are useful substitutes or profile matches.
  Blockers, proof summaries, score dimensions, classification_version,
  query_strategy, and pricing metadata are preserved when supplied by the API.
  --threshold controls sensitivity (higher = more strict match, 0.5-0.99).
  --mode can be all, likely_same, or similar_profile.
  Default output is compact JSON. Use --pretty for formatted JSON.
  Requires an authenticated viewer session, or PARCHMENT_API_KEY/PURVEYORS_API_KEY.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const coffeeId = parsePositiveIntegerArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`
        );

        const threshold = parseFiniteNumberArg(
          opts.threshold as string,
          `Invalid --threshold: "${opts.threshold}". Must be a number between 0 and 1.`
        );
        const limit = parsePositiveIntegerArg(
          opts.limit as string,
          `Invalid --limit: "${opts.limit}". Must be a positive integer.`
        );
        if (threshold < 0.5 || threshold > 0.99) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --threshold: "${opts.threshold}". Must be a number between 0.5 and 0.99.`
          );
        }
        if (limit > 25) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --limit: "${opts.limit}". Must be a positive integer up to 25.`
          );
        }
        const mode = opts.mode as string;
        if (!catalogSimilarityModes.includes(mode as (typeof catalogSimilarityModes)[number])) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --mode: "${mode}". Must be one of: ${catalogSimilarityModes.join(', ')}.`
          );
        }
        const stockedOnly = Boolean(opts.stockedOnly);
        const supabase = await resolveCatalogReadClient('viewer', true);

        const response = await getCatalogSimilarity(supabase, {
          coffee_id: coffeeId,
          threshold,
          limit,
          stockedOnly,
          mode: mode as (typeof catalogSimilarityModes)[number],
        });

        outputData(response, globalOpts);
      })
    );

  return catalog;
}
