import type { MarketSignalsQuery, PriceIndexStatsQuery, MetadataIndexQuery } from '@purveyors/sdk';
import { createOptionalParchmentClient, unwrapParchment } from './parchment.js';

/**
 * Market Index library surface (ADR-006/PADR-0011): thin, typed wrappers over
 * the canonical `/v1` Market Index endpoints for agent/tool reuse (consumed by
 * coffee-app chat). No signal/statistic computation happens here — proprietary
 * behavior stays server-side; these functions only forward params and unwrap
 * the house `{ data, pagination, meta }` envelope. `--json` CLI output and these
 * return values are the API response verbatim so agents can rely on the §3.3
 * evidence object and §3.4 enum field names.
 */

export type { MarketSignalsQuery, PriceIndexStatsQuery, MetadataIndexQuery } from '@purveyors/sdk';

/** Actionable market value signals (`GET /v1/market/signals`). */
export async function marketSignals(params: MarketSignalsQuery = {}) {
  const client = await createOptionalParchmentClient();
  return unwrapParchment(await client.market.signals(params), 'market signals');
}

/**
 * The unfiltered public signal summary (`GET /v1/market/signals?summary=true`).
 * Readable without authentication; returns counts only, never lot identity.
 */
export async function marketSignalsSummary() {
  const client = await createOptionalParchmentClient();
  return unwrapParchment(await client.market.signals({ summary: 'true' }), 'market signals');
}

/** Price movement-significance stats (`GET /v1/price-index/stats`). */
export async function marketStats(params: PriceIndexStatsQuery = {}) {
  const client = await createOptionalParchmentClient();
  return unwrapParchment(await client.priceIndex.stats(params), 'market stats');
}

/**
 * Metadata-trend index (`GET /v1/market/metadata-index`). The API `market`
 * parameter (`retail|wholesale|all`) is passed through without local
 * reinterpretation.
 */
export async function marketMetadataIndex(params: MetadataIndexQuery = {}) {
  const client = await createOptionalParchmentClient();
  return unwrapParchment(await client.market.metadataIndex(params), 'market metadata');
}
