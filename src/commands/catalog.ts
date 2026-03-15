import { Command } from 'commander';
import { createAnonClient } from '../lib/supabase.js';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling } from '../lib/errors.js';
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
 * The coffee_catalog table is publicly readable; no auth required.
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
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = createAnonClient();

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
    .action(
      withErrorHandling(async (id: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = createAnonClient();

        const data = await getCatalog(supabase, parseInt(id, 10));
        outputData(data, globalOpts);
      })
    );

  // ── catalog stats ─────────────────────────────────────────────────────────
  catalog
    .command('stats')
    .description('Aggregate statistics for the coffee catalog')
    .action(
      withErrorHandling(async (_opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = createAnonClient();

        const stats = await getCatalogStats(supabase);
        outputData(stats, globalOpts);
      })
    );

  return catalog;
}
