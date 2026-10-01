import type { ConfirmedActionExecuteRequest } from '@purveyors/sdk';

/**
 * Parchment SDK capabilities available to the Cherry web agent.
 *
 * Mirrors reedwhetstone/parchment-api@335e609920e445ec63d36e406a2462737d771bc3:
 * - `sdkMethods`: methods on the ParchmentClient-shaped adapter built by
 *   `createDirectChatCapabilityClient` in packages/api/src/chat/capabilityClient.ts
 *   and called by the chat tools (packages/api/src/chat/tools/*.ts, runtime.ts,
 *   marketTools.ts, agentPriceIndex.ts, agentSimilarity.ts).
 * - `confirmedActions`: action types the chat write tools propose and
 *   packages/api/src/confirmedActions/index.ts executes after session-only
 *   confirmation (`/v1/confirmed-actions/execute` does not accept API keys).
 *   Tool names differ for two of them: `create_roast_from_artisan_reference`
 *   proposes `create_roast_from_reference`, and `save_generated_reference_profile`
 *   proposes `create_generated_reference`.
 *
 * When @purveyors/sdk exports this list, delete this file and change the import
 * in tests/web-agent-parity.test.ts.
 */
export const WEB_AGENT_CAPABILITIES = {
  sdkMethods: [
    'me',
    'catalog.list',
    'catalog.facets',
    'catalog.rank',
    'catalog.suppliers',
    'catalog.similar',
    'inventory.list',
    'roasts.list',
    'roasts.get',
    'roasts.chartData',
    'referenceProfiles.list',
    'referenceProfiles.get',
    'referenceProfiles.chart',
    'referenceProfiles.compare',
    'referenceProfiles.preview',
    'tasting.get',
    'priceIndex.list',
    'priceIndex.stats',
    'market.signals',
    'market.metadataIndex',
  ],
  confirmedActions: [
    'add_bean_to_inventory',
    'update_bean',
    'create_roast_session',
    'create_roast_from_reference',
    'create_generated_reference',
    'update_roast_notes',
    'record_sale',
  ] satisfies readonly ConfirmedActionExecuteRequest['actionType'][],
} as const;
