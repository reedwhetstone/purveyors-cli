import { Command } from 'commander';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import {
  searchCatalog,
  getCatalog,
  getCatalogStats,
  getCatalogSimilarity,
  getCatalogFacets,
  listCatalogFacets,
  rankCatalog,
  catalogRankPremium,
  supplierList,
  supplierDetail,
  supplierRank,
  computeCatalogStats,
  sanitizeFilterValue,
  catalogSortFields,
  CATALOG_SEARCH_MAX_LIMIT,
  SUPPLIER_MIN_COFFEES_MAX,
  catalogFacetFields,
  catalogRankObjectives,
  catalogSimilarityModes,
  compareCatalog,
  getCatalogPriceHistory,
  gradeDimensions,
  listCatalogGrades,
  scoreProtocols,
  type GradeDimension,
} from '../lib/catalog.js';
import type { CatalogItem, CatalogStats, CatalogSortField } from '../lib/catalog.js';
import { CLI_NUMERIC_BOUNDS } from '../lib/numeric-contracts.js';
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
 * Requires an authenticated viewer session or an API key. Parchment decides
 * access to structured process filters and similarity; the CLI does not pre-check
 * roles for them.
 */
export function buildCatalogCommand(): Command {
  const catalog = new Command('catalog').description('Browse the coffee catalog');

  // ── catalog search ────────────────────────────────────────────────────────
  catalog
    .command('search')
    .description('Search coffees by origin, process, price, or catalog metadata')
    .option('--origin <origin>')
    .option('--process <method>')
    .option('--processing-base-method <method>')
    .option('--fermentation-type <type>')
    .option('--process-additive <additive>')
    .option('--processing-disclosure-level <level>')
    .option('--processing-confidence-min <n>')
    .option('--price-min <n>')
    .option('--price-max <n>')
    .option('--name <text>')
    .option('--ids <n,n,...>')
    .option('--variety <text>')
    .option('--stocked-days <n>')
    .option('--supplier <name>')
    .option('--drying-method <method>')
    .option('--flavor <keywords>')
    .option('--stocked')
    .option('--sort <field>')
    .option('--offset <n>', '', '0')
    .option('--limit <n>', '', '10')
    .option('--include-proof')
    .option('--elevation-min <masl>')
    .option('--elevation-max <masl>')
    .option('--screen-min <n>')
    .option('--screen-max <n>')
    .option('--grade <codes>')
    .option('--grade-kind <kind>')
    .option('--peaberry')
    .option('--lab-analyzed')
    .option('--moisture-max <pct>')
    .option('--score-protocol <protocol>')
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
  purvey catalog search --supplier "Royal" --stocked --pretty
  purvey catalog search --flavor "blueberry,jasmine" --drying-method "raised bed" --pretty
  purvey catalog search --origin "Ethiopia" --include-proof --json
  purvey catalog search --grade KE:AA,KE:AB --screen-min 17 --stocked --pretty
  purvey catalog search --grade-kind altitude --elevation-min 1600 --pretty
  purvey catalog search --lab-analyzed --moisture-max 11 --pretty

Sort fields:
  price       cheapest first
  price-desc  most expensive first
  name        alphabetical by name
  origin      alphabetical by country

Notes:
  All filters are optional. Without flags, returns up to --limit results.
  --origin accepts partial matches (e.g. "Ethiopia" matches "Ethiopia Guji").
  --process matches the broad processing label.
  --processing-base-method, --fermentation-type, --process-additive, and
  --processing-disclosure-level require exact structured metadata matches.
  --processing-confidence-min accepts a decimal from 0 to 1.
  --variety filters on cultivar_detail (partial match, case-insensitive).
  --stocked-days N shows only coffees stocked within the last N days.
  --ids fetches specific catalog items by ID, ignoring --limit and --offset.
  --offset + --limit enables pagination through large result sets.
  --include-proof adds a proof summary to each coffee; without it the output shape
  is unchanged.
  Grading filters (--elevation-*, --screen-*, --grade, --grade-kind, --peaberry,
  --lab-analyzed, --moisture-max, --score-protocol) add a grading object to each
  result. List codes with 'purvey catalog grades'.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
        const limit = parseBoundedPositiveIntegerArg(
          opts.limit as string,
          '--limit',
          CLI_NUMERIC_BOUNDS.catalogSearchLimit.minimum,
          CATALOG_SEARCH_MAX_LIMIT
        );

        let flavor: string[] | undefined;
        if (opts.flavor !== undefined) {
          flavor = String(opts.flavor)
            .split(',')
            .map((keyword) => keyword.trim())
            .filter(Boolean);
          if (flavor.length === 0) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --flavor: "${String(opts.flavor)}". Provide at least one keyword.`
            );
          }
        }

        const intOption = (flag: string, value: unknown, min: number, max: number) => {
          if (value === undefined) return undefined;
          const parsed = parsePositiveIntegerArg(
            String(value),
            `Invalid ${flag}: "${String(value)}". Must be a whole number from ${min} to ${max}.`
          );
          if (parsed < min || parsed > max) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid ${flag}: "${String(value)}". Must be a whole number from ${min} to ${max}.`
            );
          }
          return parsed;
        };
        const elevationMin = intOption('--elevation-min', opts.elevationMin, 1, 6000);
        const elevationMax = intOption('--elevation-max', opts.elevationMax, 1, 6000);
        const screenMin = intOption('--screen-min', opts.screenMin, 8, 20);
        const screenMax = intOption('--screen-max', opts.screenMax, 8, 20);
        let gradeCodes: string[] | undefined;
        if (opts.grade !== undefined) {
          gradeCodes = String(opts.grade)
            .split(',')
            .map((code) => code.trim().toUpperCase())
            .filter(Boolean);
          const invalid = gradeCodes.find(
            (code) => !/^[A-Z][A-Z0-9_]*:[A-Z0-9][A-Z0-9_]*$/.test(code)
          );
          if (gradeCodes.length === 0 || invalid) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --grade: "${String(opts.grade)}". Use comma-separated codes like KE:AA,PREP:EP (see 'purvey catalog grades').`
            );
          }
        }
        const gradeKind = opts.gradeKind as string | undefined;
        if (gradeKind !== undefined && !gradeDimensions.includes(gradeKind as GradeDimension)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --grade-kind: "${gradeKind}". Must be one of: ${gradeDimensions.join(', ')}.`
          );
        }
        const moistureMax =
          opts.moistureMax !== undefined
            ? parseFiniteNumberArg(
                opts.moistureMax as string,
                `Invalid --moisture-max: "${String(opts.moistureMax)}". Must be a number from 0 to 20.`
              )
            : undefined;
        if (moistureMax !== undefined && (moistureMax < 0 || moistureMax > 20)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --moisture-max: "${String(opts.moistureMax)}". Must be a number from 0 to 20.`
          );
        }
        const scoreProtocol = opts.scoreProtocol as string | undefined;
        if (
          scoreProtocol !== undefined &&
          !(scoreProtocols as readonly string[]).includes(scoreProtocol)
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --score-protocol: "${scoreProtocol}". Must be one of: ${scoreProtocols.join(', ')}.`
          );
        }

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
          supplier: opts.supplier as string | undefined,
          dryingMethod: opts.dryingMethod as string | undefined,
          flavor,
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
          elevationMin,
          elevationMax,
          screenMin,
          screenMax,
          gradeCodes,
          gradeDimension: gradeKind as GradeDimension | undefined,
          peaberry: opts.peaberry ? true : undefined,
          labAnalyzed: opts.labAnalyzed ? true : undefined,
          moistureMax,
          scoreProtocol: scoreProtocol as (typeof scoreProtocols)[number] | undefined,
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
    .option('--include-proof')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog get 128 --pretty
  purvey catalog get 128 --include-proof --json
  purvey catalog get 42 | jq '{name, origin, process, cost_lb}'
  purvey catalog get 77 --csv

Notes:
  <id> is the catalog ID (integer).
  Use 'purvey catalog search' to find IDs.
  --include-proof adds the coffee's proof summary.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const catalogId = parseInt4IdArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric catalog ID.`
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
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
    .command('facets [field]')
    .description('List counted catalog facet values for filter discovery')
    .option('--all')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog facets supplier --pretty
  purvey catalog facets country --all --json
  purvey catalog facets --pretty      # every non-grading facet
  purvey catalog facets grade_altitude --pretty

Fields:
  supplier, country, processing_base_method, fermentation_type, drying_method, wholesale
  Grading (member access or API key): grade_size, grade_altitude, grade_defects,
  grade_cup, grade_preparation, screen_size_min, elevation_band

Notes:
  Without a field, prints every non-grading facet with its counted values and
  meta (values, facets, meta); name a grading field to get its counts.
  With a field, prints { field, facet, data, meta }: that facet's counted values and meta.
  Counts include only coffees you can see; counts for multi-valued dimensions can
  overlap, so do not sum them.
  By default only currently stocked catalog rows are included; use --all for all visible rows.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
`
    )
    .action(
      withErrorHandling(
        async (field: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;
          const stockedOnly = opts.all ? false : true;
          if (field === undefined) {
            outputData(await getCatalogFacets({ stockedOnly }), globalOpts);
            return;
          }
          if (!catalogFacetFields.includes(field as (typeof catalogFacetFields)[number])) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid field: "${field}". Must be one of: ${catalogFacetFields.join(', ')}.`
            );
          }
          const data = await listCatalogFacets({
            field: field as (typeof catalogFacetFields)[number],
            stockedOnly,
          });

          outputData(data, globalOpts);
        }
      )
    );

  // ── catalog rank ─────────────────────────────────────────────────────────
  catalog
    .command('rank')
    .description('Rank catalog coffees for a goal: premium, value, fresh arrivals, or rare origins')
    .option('--objective <objective>', '', 'premium')
    .option('--supplier <name>')
    .option('--country <country>')
    .option('--process <method>')
    .option('--stocked')
    .option('--all')
    .option('--price-max <n>')
    .option('--min-score <n>')
    .option('--non-wholesale-only')
    .option('--sample-size <n>', '', '5000')
    .option('--limit <n>', '', '10')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog rank --objective premium --stocked --limit 10 --pretty
  purvey catalog rank --objective value --country Ethiopia --price-max 12 --json
  purvey catalog rank --objective rare_origin --stocked --pretty
  purvey catalog rank --objective premium --supplier "Royal Coffee" --limit 5 --json

Notes:
  Objectives: premium, value, fresh_arrival, rare_origin.
  Uses the Purveyor Score as the quality signal.
  Generic ranking samples catalog rows ordered by id before deterministic ranking;
  meta.stocked_only/scope, sample_size, and truncated describe that scope, which matters for rare_origin.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
          supplier: opts.supplier as string | undefined,
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
    .option('--origin <origin>')
    .option('--process <method>')
    .option('--stocked')
    .option('--price-max <n>')
    .option('--min-score <n>')
    .option('--include-unscored')
    .option('--sample-size <n>', '', '250')
    .option('--limit <n>', '', '10')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog rank-premium --stocked --limit 10 --pretty
  purvey catalog rank-premium --origin Ethiopia --min-score 88 --json

Notes:
  Ranks by Purveyor Score (purveyor_score in output) and adds transparent ranking
  signals for agents.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
    .description('Summarize suppliers from the catalog coffees they list')
    .option('--country <country>')
    .option('--stocked')
    .option('--non-wholesale-only')
    .option('--sample-size <n>', '', '5000')
    .option('--limit <n>', '', '25')
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
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
    .option('--country <country>')
    .option('--stocked')
    .option('--non-wholesale-only')
    .option('--top-coffees <n>', '', '5')
    .option('--sample-size <n>', '', '5000')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog supplier-detail "Royal Coffee" --pretty
  purvey catalog supplier-detail "Cafe Imports" --country Colombia --stocked --json

Notes:
  Supplier matching is case-insensitive and partial, mirroring catalog search.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
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
    .option('--country <country>')
    .option('--stocked')
    .option('--non-wholesale-only')
    .option('--min-coffees <n>', '', '1')
    .option('--sample-size <n>', '', '5000')
    .option('--limit <n>', '', '25')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog supplier-rank --stocked --min-coffees 3 --pretty
  purvey catalog supplier-rank --country Ethiopia --non-wholesale-only --limit 10 --json

Notes:
  Ranks suppliers by average Purveyor Score, then currently stocked count.
  Requires a sign-in ('purvey auth login') or an API key with catalog:read.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const input = {
          country: opts.country as string | undefined,
          stocked: opts.stocked ? true : undefined,
          nonWholesaleOnly: opts.nonWholesaleOnly ? true : undefined,
          minCoffees: parseBoundedPositiveIntegerArg(
            opts.minCoffees as string,
            '--min-coffees',
            CLI_NUMERIC_BOUNDS.supplierMinCoffees.minimum,
            SUPPLIER_MIN_COFFEES_MAX
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
    .description('Beta: find likely same-lot candidates and similar coffees for a catalog coffee')
    .option('--threshold <score>', '', '0.7')
    .option('--limit <count>', '', '10')
    .option('--stocked-only')
    .option('--mode <mode>', '', 'all')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog similar 1182
  purvey catalog similar 1182 --threshold 0.85 --stocked-only --pretty
  purvey catalog similar 1182 --mode likely_same --json | jq '.data.groups.canonical_candidates'
  purvey catalog similar 1182 --json | jq '.data.groups.similar_recommendations[0].match.classification.blockers'

Notes:
  Results are beta candidates to review, not confirmed matches.
  JSON output groups matches under data.target and data.groups.
  data.groups.canonical_candidates are likely same-lot candidates.
  data.groups.similar_recommendations are useful substitutes or profile matches.
  Blockers, proof summaries, score dimensions, classification_version,
  query_strategy, and pricing metadata are kept as returned.
  Default output is compact JSON. Use --pretty for formatted JSON.
  Needs a sign-in ('purvey auth login') or any API key with catalog:read. The free
  Green API plan includes it within its monthly quota.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        const coffeeId = parseInt4IdArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric catalog ID.`
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

  // ── catalog compare <ids...> ──────────────────────────────────────────────
  catalog
    .command('compare <ids...>')
    .description('Compare 2 to 6 coffees side by side, priced at your quantity')
    .option('--quantity <lb>')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog compare 416 8806 --pretty
  purvey catalog compare 416 8806 1182 --quantity 5 --json | jq '.data.bestPriceLotIds'

Notes:
  Rows are grouped (Price, Availability, Origin, Process, Coffee, Grading, Taste,
  Listing) and marked same, partial, or different; price rows name the cheapest
  lots. Grading rows never carry best marks.
  Viewer accounts compare 2 coffees; member accounts and API keys compare up to 6.
`
    )
    .action(
      withErrorHandling(async (ids: string[], opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const parsedIds = ids
          .flatMap((token) => token.split(','))
          .map((token) => token.trim())
          .filter(Boolean)
          .map((token) =>
            parseInt4IdArg(token, `Invalid ID: "${token}". Each ID must be a positive integer.`)
          );
        if (parsedIds.length < 2 || parsedIds.length > 6) {
          throw new PrvrsError('INVALID_ARGUMENT', 'Compare takes 2 to 6 catalog IDs.');
        }
        const quantityLbs =
          opts.quantity !== undefined
            ? parseFiniteNumberArg(
                opts.quantity as string,
                `Invalid --quantity: "${String(opts.quantity)}". Must be a positive number of pounds.`
              )
            : undefined;
        if (quantityLbs !== undefined && (quantityLbs <= 0 || quantityLbs > 10000)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --quantity: "${String(opts.quantity)}". Must be a positive number of pounds up to 10000.`
          );
        }
        outputData(await compareCatalog({ ids: parsedIds, quantityLbs }), globalOpts);
      })
    );

  // ── catalog price-history <id> ────────────────────────────────────────────
  catalog
    .command('price-history <id>')
    .description('Daily smallest-tier price history for one coffee')
    .option('--days <n>', '', '180')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog price-history 1182 --pretty
  purvey catalog price-history 1182 --days 90 --json | jq '.data.summary'

Notes:
  Prices track the smallest order tier. Events flag days when the smallest
  tier's quantity changed, which makes prices before and after not directly
  comparable. Member access or a customer API key is required.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const coffeeId = parseInt4IdArg(
          id,
          `Invalid ID: "${id}". Please provide a numeric catalog ID.`
        );
        const days = parseBoundedPositiveIntegerArg(opts.days as string, '--days', 7, 365);
        outputData(await getCatalogPriceHistory({ id: coffeeId, days }), globalOpts);
      })
    );

  // ── catalog grades [codes...] ─────────────────────────────────────────────
  catalog
    .command('grades [codes...]')
    .description('Explain green grade codes such as KE:AA, ET:G1, GT:SHB, or PREP:EP')
    .option('--kind <kind>')
    .option('--system <system>')
    .option('--include-retired')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog grades --pretty
  purvey catalog grades KE:AA ET:G1 --pretty
  purvey catalog grades --kind altitude --json | jq '.data[].code'
  purvey catalog grades --system BR --pretty

Notes:
  Codes are <system>:<token>. Kinds are size, altitude, defects, cup, and
  preparation; composite grades such as ET:G1 carry more than one. Implied
  ranges come from the published definition, not from any lot's disclosure.
  Unknown codes are listed under unknownCodes.
`
    )
    .action(
      withErrorHandling(async (codes: string[], opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const kind = opts.kind as string | undefined;
        if (kind !== undefined && !gradeDimensions.includes(kind as GradeDimension)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --kind: "${kind}". Must be one of: ${gradeDimensions.join(', ')}.`
          );
        }
        outputData(
          await listCatalogGrades({
            codes: codes
              .flatMap((code) => code.split(','))
              .map((code) => code.trim())
              .filter(Boolean),
            dimension: kind as GradeDimension | undefined,
            system: opts.system as string | undefined,
            includeRetired: opts.includeRetired ? true : undefined,
          }),
          globalOpts
        );
      })
    );

  return catalog;
}
