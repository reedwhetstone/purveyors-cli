import { Command } from 'commander';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import {
  searchCatalog,
  getCatalog,
  getCatalogStats,
  getCatalogSimilarity,
  listCatalogFacets,
  rankCatalog,
  catalogRankPremium,
  supplierList,
  supplierDetail,
  supplierRank,
  computeCatalogStats,
  sanitizeFilterValue,
  catalogSortFields,
  catalogFacetFields,
  catalogRankObjectives,
  catalogSimilarityModes,
} from '../lib/catalog.js';
import type { CatalogItem, CatalogStats, CatalogSortField } from '../lib/catalog.js';
import {
  parseStrictInt4Id,
  parseStrictOffset,
  parseStrictPositiveCount,
} from '../lib/strict-number.js';
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
  const parsed = parseStrictPositiveCount(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  return parsed;
}

function parseInt4IdArg(rawValue: string, message: string): number {
  const parsed = parseStrictInt4Id(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError('INVALID_ARGUMENT', message);
  }

  return parsed;
}

function parseBoundedPositiveIntegerArg(
  rawValue: string,
  flag: string,
  min: number,
  max: number
): number {
  const parsed = parsePositiveIntegerArg(
    rawValue,
    `Invalid ${flag}: "${rawValue}". Must be a positive integer.`
  );

  if (parsed < min || parsed > max) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${rawValue}". Must be between ${min} and ${max}.`
    );
  }

  return parsed;
}

function parseNonNegativeIntegerArg(rawValue: string, message: string): number {
  const parsed = parseStrictOffset(rawValue);
  if (!Number.isFinite(parsed)) {
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
    .description('Search coffees by origin, process, price, or catalog metadata')
    .option('--origin <origin>', 'Filter by origin (country, continent, or region)')
    .option('--process <method>', 'Filter by processing method (e.g. natural, washed)')
    .option('--processing-base-method <method>', 'Filter by canonical process base method')
    .option('--fermentation-type <type>', 'Filter by structured fermentation type')
    .option('--process-additive <additive>', 'Filter by disclosed process additive')
    .option('--processing-disclosure-level <level>', 'Filter by process disclosure level')
    .option('--processing-confidence-min <n>', 'Minimum process metadata confidence (0-1)')
    .option('--price-min <n>', 'Minimum price per lb (USD)')
    .option('--price-max <n>', 'Maximum price per lb (USD)')
    .option('--name <text>', 'Filter by coffee name (partial match, case-insensitive)')
    .option('--ids <n,n,...>', 'Fetch specific catalog IDs (comma-separated, ignores limit)')
    .option('--variety <text>', 'Filter by coffee variety/cultivar (partial match)')
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
  purvey catalog search --processing-base-method "Natural" --fermentation-type "Anaerobic" --pretty
  purvey catalog search --process-additive "hops" --processing-confidence-min 0.8 --pretty
  purvey catalog search --price-min 5 --price-max 12 --stocked --limit 20
  purvey catalog search --stocked --sort price --pretty
  purvey catalog search --stocked --limit 10 --offset 10   # page 2
  purvey catalog search --origin "Ethiopia" --csv > ethiopia.csv
  purvey catalog search --stocked --limit 50 | jq '.[].name'
  purvey catalog search --name "Guji" --pretty
  purvey catalog search --ids "1182,1183,1200"
  purvey catalog search --variety "gesha" --stocked --pretty
  purvey catalog search --stocked-days 30 --pretty
  purvey catalog search --origin "Ethiopia" --include-proof --json

Sort fields:
  price       cheapest first
  price-desc  most expensive first
  name        alphabetical by name
  origin      alphabetical by country

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
  --variety filters on cultivar_detail (partial match, case-insensitive).
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
              parseInt4IdArg(
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

        const includeProof = opts.includeProof ? true : undefined;
        const data = await searchCatalog({
          origin: opts.origin as string | undefined,
          process: opts.process as string | undefined,
          priceMin,
          priceMax,
          name: opts.name as string | undefined,
          ids: parsedIds,
          variety: opts.variety as string | undefined,
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
        const catalogId = parseInt4IdArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`
        );

        const includeProof = opts.includeProof ? true : undefined;
        const data = await getCatalog(catalogId, {
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
        const stats = await getCatalogStats();
        outputData(stats, globalOpts);
      })
    );

  // ── catalog facets ───────────────────────────────────────────────────────
  catalog
    .command('facets <field>')
    .description('List distinct catalog facet values with counts')
    .option('--all', 'Use all visible catalog rows instead of default stocked-only scope')
    .option('--limit <n>', 'Maximum facet values to return (1-100)', '60')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog facets supplier --pretty
  purvey catalog facets country --limit 25 --json
  purvey catalog facets processing_base_method --pretty

Fields:
  supplier, country, processing_base_method, fermentation_type, drying_method, grade, wholesale

Notes:
  Facet counts are computed from catalog rows visible to the current client.
  By default only currently stocked catalog rows are included; use --all for all visible rows.
  meta.stocked_only/scope, meta.rows_examined, and meta.truncated describe the canonical counted scope.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (field: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        if (!catalogFacetFields.includes(field as (typeof catalogFacetFields)[number])) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid field: "${field}". Must be one of: ${catalogFacetFields.join(', ')}.`
          );
        }
        const input = {
          field: field as (typeof catalogFacetFields)[number],
          stockedOnly: opts.all ? false : true,
          limit: parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 100),
        };
        const data = await listCatalogFacets(input);

        outputData(data, globalOpts);
      })
    );

  // ── catalog rank ─────────────────────────────────────────────────────────
  catalog
    .command('rank')
    .description('Rank catalog candidates by a deterministic objective')
    .option(
      '--objective <objective>',
      `Ranking objective: ${catalogRankObjectives.join(', ')}`,
      'premium'
    )
    .option('--country <country>', 'Filter by country')
    .option('--process <method>', 'Filter by processing method')
    .option('--stocked', 'Only include currently stocked coffees')
    .option('--all', 'Use all visible catalog rows instead of default stocked-only scope')
    .option('--price-max <n>', 'Maximum price per lb (USD)')
    .option('--min-score <n>', 'Minimum Purveyor Score')
    .option('--non-wholesale-only', 'Exclude wholesale listings before sampling')
    .option('--sample-size <n>', 'Rows to sample before ranking (1-5000)', '5000')
    .option('--limit <n>', 'Maximum ranked coffees to return (1-50)', '10')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog rank --objective premium --stocked --limit 10 --pretty
  purvey catalog rank --objective value --country Ethiopia --price-max 12 --json
  purvey catalog rank --objective rare_origin --stocked --pretty

Notes:
  Objectives: premium, value, fresh_arrival, rare_origin.
  Uses coffee_catalog.purveyor_score as the canonical quality signal.
  Generic ranking samples catalog rows ordered by id before deterministic ranking;
  meta.stocked_only/scope, sample_size, and truncated describe that scope, which matters for rare_origin.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const objective = opts.objective as string;
        if (!catalogRankObjectives.includes(objective as (typeof catalogRankObjectives)[number])) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --objective: "${objective}". Must be one of: ${catalogRankObjectives.join(', ')}.`
          );
        }
        const input = {
          objective: objective as (typeof catalogRankObjectives)[number],
          country: opts.country as string | undefined,
          process: opts.process as string | undefined,
          stockedOnly: opts.all ? false : opts.stocked ? true : true,
          priceMax:
            opts.priceMax !== undefined
              ? parseFiniteNumberArg(
                  opts.priceMax as string,
                  `Invalid --price-max: "${opts.priceMax}". Must be a number.`
                )
              : undefined,
          minScore:
            opts.minScore !== undefined
              ? parseFiniteNumberArg(
                  opts.minScore as string,
                  `Invalid --min-score: "${opts.minScore}". Must be a number.`
                )
              : undefined,
          nonWholesaleOnly: opts.nonWholesaleOnly ? true : undefined,
          sampleSize: parseBoundedPositiveIntegerArg(
            opts.sampleSize as string,
            '--sample-size',
            1,
            5000
          ),
          limit: parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 50),
        };
        const data = await rankCatalog(input);

        outputData(data, globalOpts);
      })
    );

  // ── catalog rank-premium ─────────────────────────────────────────────────
  catalog
    .command('rank-premium')
    .description('Rank premium catalog candidates by Purveyor Score')
    .option('--origin <origin>', 'Filter by origin (country, continent, or region)')
    .option('--process <method>', 'Filter by processing method')
    .option('--stocked', 'Only include currently stocked coffees')
    .option('--price-max <n>', 'Maximum price per lb (USD)')
    .option('--min-score <n>', 'Minimum Purveyor Score')
    .option('--include-unscored', 'Allow unscored rows to appear after scored rows')
    .option('--sample-size <n>', 'Rows to sample before ranking (1-5000)', '250')
    .option('--limit <n>', 'Maximum ranked coffees to return (1-50)', '10')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog rank-premium --stocked --limit 10 --pretty
  purvey catalog rank-premium --origin Ethiopia --min-score 88 --json

Notes:
  Ranks by coffee_catalog.score_value, exposed as purveyor_score in output.
  The CLI does not recompute the upstream score model; it preserves the score field
  and adds transparent ranking signals for agents.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const input = {
          origin: opts.origin as string | undefined,
          process: opts.process as string | undefined,
          stocked: opts.stocked ? true : undefined,
          priceMax:
            opts.priceMax !== undefined
              ? parseFiniteNumberArg(
                  opts.priceMax as string,
                  `Invalid --price-max: "${opts.priceMax}". Must be a number.`
                )
              : undefined,
          minScore:
            opts.minScore !== undefined
              ? parseFiniteNumberArg(
                  opts.minScore as string,
                  `Invalid --min-score: "${opts.minScore}". Must be a number.`
                )
              : undefined,
          includeUnscored: opts.includeUnscored ? true : undefined,
          sampleSize: parseBoundedPositiveIntegerArg(
            opts.sampleSize as string,
            '--sample-size',
            1,
            5000
          ),
          limit: parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 50),
        };
        const data = await catalogRankPremium(input);

        outputData(data, globalOpts);
      })
    );

  // ── catalog supplier aggregates ──────────────────────────────────────────
  catalog
    .command('supplier-list')
    .description('List supplier aggregates from catalog rows')
    .option('--country <country>', 'Filter by country')
    .option('--stocked', 'Only include currently stocked coffees')
    .option('--non-wholesale-only', 'Exclude wholesale listings before aggregation')
    .option(
      '--sample-size <n>',
      'Catalog rows to fetch per page before aggregation (1-5000)',
      '5000'
    )
    .option('--limit <n>', 'Maximum suppliers to return (1-100)', '25')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog supplier-list --stocked --pretty
  purvey catalog supplier-list --country Ethiopia --non-wholesale-only --json
  purvey catalog supplier-list --limit 50 --json

Notes:
  Aggregates supplier count, stocked count, Purveyor Score coverage, average score,
  price range, origin coverage, process coverage, and representative top coffees.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const input = {
          country: opts.country as string | undefined,
          stocked: opts.stocked ? true : undefined,
          nonWholesaleOnly: opts.nonWholesaleOnly ? true : undefined,
          sampleSize: parseBoundedPositiveIntegerArg(
            opts.sampleSize as string,
            '--sample-size',
            1,
            5000
          ),
          limit: parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 100),
        };
        const data = await supplierList(input);

        outputData(data, globalOpts);
      })
    );

  catalog
    .command('supplier-detail <supplier>')
    .description('Show aggregate detail for a supplier query')
    .option('--country <country>', 'Filter by country')
    .option('--stocked', 'Only include currently stocked coffees')
    .option('--non-wholesale-only', 'Exclude wholesale listings before aggregation')
    .option('--top-coffees <n>', 'Representative top coffees to include (1-25)', '5')
    .option(
      '--sample-size <n>',
      'Catalog rows to fetch per page before aggregation (1-5000)',
      '5000'
    )
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog supplier-detail "Royal Coffee" --pretty
  purvey catalog supplier-detail "Cafe Imports" --country Colombia --stocked --json

Notes:
  Supplier matching is case-insensitive and partial, mirroring catalog search.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (supplier: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const input = {
          supplier,
          country: opts.country as string | undefined,
          stocked: opts.stocked ? true : undefined,
          nonWholesaleOnly: opts.nonWholesaleOnly ? true : undefined,
          topCoffees: parseBoundedPositiveIntegerArg(
            opts.topCoffees as string,
            '--top-coffees',
            1,
            25
          ),
          sampleSize: parseBoundedPositiveIntegerArg(
            opts.sampleSize as string,
            '--sample-size',
            1,
            5000
          ),
        };
        const data = await supplierDetail(input);

        outputData(data, globalOpts);
      })
    );

  catalog
    .command('supplier-rank')
    .description('Rank suppliers by average Purveyor Score and stocked coverage')
    .option('--country <country>', 'Filter by country')
    .option('--stocked', 'Only include currently stocked coffees')
    .option('--non-wholesale-only', 'Exclude wholesale listings before aggregation')
    .option('--min-coffees <n>', 'Minimum catalog rows required per supplier', '1')
    .option(
      '--sample-size <n>',
      'Catalog rows to fetch per page before aggregation (1-5000)',
      '5000'
    )
    .option('--limit <n>', 'Maximum suppliers to return (1-100)', '25')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog supplier-rank --stocked --min-coffees 3 --pretty
  purvey catalog supplier-rank --country Ethiopia --non-wholesale-only --limit 10 --json

Notes:
  Ranks suppliers by average Purveyor Score, then currently stocked count.
  Requires an authenticated viewer session.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const input = {
          country: opts.country as string | undefined,
          stocked: opts.stocked ? true : undefined,
          nonWholesaleOnly: opts.nonWholesaleOnly ? true : undefined,
          minCoffees: parsePositiveIntegerArg(
            opts.minCoffees as string,
            `Invalid --min-coffees: "${opts.minCoffees}". Must be a positive integer.`
          ),
          sampleSize: parseBoundedPositiveIntegerArg(
            opts.sampleSize as string,
            '--sample-size',
            1,
            5000
          ),
          limit: parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 100),
        };
        const data = await supplierRank(input);

        outputData(data, globalOpts);
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
  Requires an authenticated member session, or a paid PARCHMENT_API_KEY/PURVEYORS_API_KEY.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const coffeeId = parseInt4IdArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`
        );

        const threshold = parseFiniteNumberArg(
          opts.threshold as string,
          `Invalid --threshold: "${opts.threshold}". Must be a number between 0 and 1.`
        );
        const limit = parseBoundedPositiveIntegerArg(opts.limit as string, '--limit', 1, 25);
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
        const response = await getCatalogSimilarity({
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
