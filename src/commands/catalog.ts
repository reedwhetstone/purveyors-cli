import { Command } from 'commander';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import {
  searchCatalog,
  getCatalog,
  getCatalogStats,
  findSimilarBeans,
  computeCatalogStats,
  sanitizeFilterValue,
  catalogSortFields,
} from '../lib/catalog.js';
import type { CatalogItem, CatalogStats, CatalogSortField, SimilarBean } from '../lib/catalog.js';
import type { OutputOptions } from '../types/index.js';

// Re-export types and helpers for backwards compatibility
export type { CatalogItem, CatalogStats };
export { sanitizeFilterValue, computeCatalogStats };

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
 * Requires an authenticated viewer session.
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
  --processing-base-method, --fermentation-type, --process-additive, and
  --processing-disclosure-level require exact structured metadata matches.
  --processing-confidence-min accepts a decimal from 0 to 1.
  --name and --supplier accept partial matches (case-insensitive).
  --variety filters on cultivar_detail (partial match, case-insensitive).
  --drying-method filters on drying_method (partial match, case-insensitive).
  --stocked-days N shows only coffees stocked within the last N days.
  --ids fetches specific catalog items by ID, ignoring --limit and --offset.
  --offset + --limit enables pagination through large result sets.
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

        const { supabase } = await requireAuth('viewer');

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
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog get 128 --pretty
  purvey catalog get 42 | jq '{name, origin, process, cost_lb}'
  purvey catalog get 77 --csv

Notes:
  <id> is the coffee_catalog.catalog_id (integer).
  Use 'purvey catalog search' to find IDs.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const catalogId = parsePositiveIntegerArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`
        );

        const { supabase } = await requireAuth('viewer');
        const data = await getCatalog(supabase, catalogId);
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
    .description('Find similar beans across all suppliers')
    .option('--threshold <score>', 'Minimum similarity (0-1)', '0.70')
    .option('--limit <count>', 'Max results', '10')
    .option('--stocked-only', 'Only show currently stocked beans')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog similar 1182
  purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
  purvey catalog similar 1182 --json | jq '.[0]'

Notes:
  Uses pgvector cosine similarity on tasting notes and bean descriptors.
  --threshold controls sensitivity (higher = more strict match).
  Default output is compact JSON. Use --pretty for formatted JSON.
  Returns beans sorted by similarity score (highest first).
  Requires an authenticated viewer session.
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
        const stockedOnly = Boolean(opts.stockedOnly);
        const { supabase } = await requireAuth('viewer');

        // Confirm the target bean exists before running similarity lookup.
        const { data: targetBean, error: targetError } = await supabase
          .from('coffee_catalog')
          .select('catalog_id')
          .eq('catalog_id', coffeeId)
          .single();

        if (targetError || !targetBean) {
          throw new PrvrsError('NOT_FOUND', `Coffee ID ${coffeeId} not found in catalog.`);
        }

        // Call the lib function
        const results = await findSimilarBeans(supabase, {
          coffee_id: coffeeId,
          threshold: threshold,
          limit: limit,
        });

        if (results.length === 0) {
          info(`No embeddings found for coffee ID ${coffeeId}.`);
          return;
        }

        // Filter stocked-only client-side
        let filtered: SimilarBean[] = results;
        if (stockedOnly) {
          filtered = filtered.filter((r) => r.stocked);
          if (filtered.length === 0) {
            info('No stocked beans found matching the similarity threshold.');
            return;
          }
        }

        outputData(filtered, globalOpts);
      })
    );

  return catalog;
}
