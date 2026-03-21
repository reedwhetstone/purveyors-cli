import { Command } from 'commander';
import { outputData, info, warn } from '../lib/output.js';
import { withErrorHandling } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import {
  searchCatalog,
  getCatalog,
  getCatalogStats,
  computeCatalogStats,
  sanitizeFilterValue,
} from '../lib/catalog.js';
import type { CatalogItem, CatalogStats } from '../lib/catalog.js';
import type { OutputOptions } from '../types/index.js';

// Re-export types and helpers for backwards compatibility
export type { CatalogItem, CatalogStats };
export { sanitizeFilterValue, computeCatalogStats };

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey catalog` — Browse the public coffee catalog.
 * Requires authentication (viewer+).
 */
export function buildCatalogCommand(): Command {
  const catalog = new Command('catalog').description('Browse the public coffee catalog');

  // ── catalog search ────────────────────────────────────────────────────────
  catalog
    .command('search')
    .description('Search coffees by origin, process, price, or flavor')
    .option('--origin <origin>', 'Filter by origin (country, continent, or region)')
    .option('--process <method>', 'Filter by processing method (e.g. natural, washed)')
    .option('--price-min <n>', 'Minimum price per lb (USD)')
    .option('--price-max <n>', 'Maximum price per lb (USD)')
    .option('--flavor <keywords>', 'Flavor keywords, comma-separated (e.g. "berry,chocolate")')
    .option('--stocked', 'Only show currently stocked coffees')
    .option('--limit <n>', 'Maximum results to return', '10')
    .addHelpText(
      'after',
      `
Examples:
  purvey catalog search --origin "Ethiopia" --pretty
  purvey catalog search --origin "Colombia" --process "honey" --pretty
  purvey catalog search --process "natural" --flavor "blueberry,citrus" --stocked
  purvey catalog search --price-min 5 --price-max 12 --stocked --limit 20
  purvey catalog search --origin "Ethiopia" --csv > ethiopia.csv
  purvey catalog search --stocked --limit 50 | jq '.[].name'

Notes:
  All filters are optional. Without flags, returns up to --limit results.
  --origin accepts partial matches (e.g. "Ethiopia" matches "Ethiopia Guji").
  No authentication required — catalog is publicly readable.
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase } = await requireAuth('viewer');

        const data = await searchCatalog(supabase, {
          origin: opts.origin as string | undefined,
          process: opts.process as string | undefined,
          priceMin: opts.priceMin !== undefined ? parseFloat(opts.priceMin as string) : undefined,
          priceMax: opts.priceMax !== undefined ? parseFloat(opts.priceMax as string) : undefined,
          flavor: opts.flavor as string | undefined,
          stocked: opts.stocked ? true : undefined,
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
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
  No authentication required.
`
    )
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase } = await requireAuth('viewer');

        const data = await getCatalog(supabase, parseInt(id, 10));
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
  No authentication required.
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
  purvey catalog similar 1182 --threshold 0.85 --stocked-only
  purvey catalog similar 1182 --json | jq '.[0]'

Notes:
  Uses pgvector cosine similarity on tasting notes and bean descriptors.
  --threshold controls sensitivity (higher = more strict match).
  Returns beans sorted by similarity score (highest first).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions & { json?: boolean };
        const { supabase } = await requireAuth('viewer');

        const coffeeId = parseInt(id, 10);
        if (isNaN(coffeeId)) {
          warn(`Invalid ID: "${id}". Please provide a numeric coffee_catalog ID.`);
          process.exit(1);
        }

        const threshold = parseFloat(opts.threshold as string);
        const limit = Math.max(1, parseInt(opts.limit as string, 10));
        const stockedOnly = Boolean(opts.stockedOnly);

        // Fetch target bean name for the header
        const { data: targetBean, error: targetError } = await supabase
          .from('coffee_catalog')
          .select('name, source')
          .eq('catalog_id', coffeeId)
          .single();

        if (targetError || !targetBean) {
          warn(`Coffee ID ${coffeeId} not found in catalog.`);
          process.exit(1);
        }

        // Call the RPC function
        const { data: results, error: rpcError } = await supabase.rpc(
          'find_similar_beans_aggregated',
          {
            target_coffee_id: coffeeId,
            match_threshold: threshold,
            match_count: limit,
          }
        );

        if (rpcError) {
          throw new Error(`RPC error: ${rpcError.message}`);
        }

        if (!results || results.length === 0) {
          info(`No embeddings found for coffee ID ${coffeeId}.`);
          return;
        }

        // Filter stocked-only client-side
        let filtered = results as SimilarBean[];
        if (stockedOnly) {
          filtered = filtered.filter((r) => r.stocked);
          if (filtered.length === 0) {
            info('No stocked beans found matching the similarity threshold.');
            return;
          }
        }

        // JSON output: raw array
        if (globalOpts.json) {
          console.log(JSON.stringify(filtered));
          return;
        }

        // Human-readable output
        if (globalOpts.pretty) {
          outputData(filtered, globalOpts);
          return;
        }

        // Default: formatted human-readable table
        console.log(
          `\nSimilar beans to: ${targetBean.name} (ID: ${coffeeId}, ${targetBean.source})\n`
        );
        filtered.forEach((bean, i) => {
          const pct = (bean.avg_similarity * 100).toFixed(1);
          const stockedLabel = bean.stocked ? 'Stocked ✓' : 'Unstocked';
          const price = bean.cost_lb != null ? `$${bean.cost_lb.toFixed(2)}/lb` : 'price N/A';
          const origin = bean.origin || 'Unknown';
          const processing = bean.processing || 'Unknown';
          const chunkWord = bean.chunk_matches === 1 ? 'chunk' : 'chunks';
          console.log(`${i + 1}. ${bean.coffee_name} (${bean.source}) — ${pct}% similar`);
          console.log(
            `   Origin: ${origin} | Processing: ${processing} | ${price} | ${stockedLabel}`
          );
          console.log(`   Matched on: ${bean.chunk_matches} ${chunkWord}`);
          console.log('');
        });
      })
    );

  return catalog;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimilarBean {
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
