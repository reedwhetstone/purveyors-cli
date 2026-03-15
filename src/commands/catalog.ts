import { Command } from 'commander';
import { createAnonClient } from '../lib/supabase.js';
import { outputData, info } from '../lib/output.js';
import { withErrorHandling } from '../lib/errors.js';
import type { OutputOptions } from '../types/index.js';

// ─── Local types ──────────────────────────────────────────────────────────────

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

export interface CatalogStats {
  total: number;
  stocked: number;
  byOrigin: Record<string, number>;
  avgPricePerLb: number | null;
  priceRange: { min: number | null; max: number | null };
}

// ─── Pure logic (exported for unit testing) ───────────────────────────────────

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

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `prvrs catalog` — Browse the public coffee catalog.
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

        let query = supabase.from('coffee_catalog').select('*');

        if (opts.origin) {
          const o = opts.origin as string;
          query = query.or(`country.ilike.%${o}%,continent.ilike.%${o}%,region.ilike.%${o}%`);
        }

        if (opts.process) {
          query = query.ilike('processing', `%${opts.process as string}%`);
        }

        if (opts.priceMin !== undefined) {
          query = query.gte('cost_lb', parseFloat(opts.priceMin as string));
        }

        if (opts.priceMax !== undefined) {
          query = query.lte('cost_lb', parseFloat(opts.priceMax as string));
        }

        if (opts.flavor) {
          const keywords = (opts.flavor as string)
            .split(',')
            .map((k) => k.trim())
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

        if (opts.stocked) {
          query = query.eq('stocked', true);
        }

        const limit = Math.max(1, parseInt(opts.limit as string, 10));
        const { data, error } = await query.limit(limit);
        if (error) throw error;

        if (!data || data.length === 0) {
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

        const { data, error } = await supabase
          .from('coffee_catalog')
          .select('*')
          .eq('id', parseInt(id, 10))
          .single();

        if (error) throw error;
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

        const { data, error } = await supabase
          .from('coffee_catalog')
          .select('id, country, continent, cost_lb, stocked');

        if (error) throw error;

        const stats = computeCatalogStats((data ?? []) as CatalogItem[]);
        outputData(stats, globalOpts);
      })
    );

  return catalog;
}
