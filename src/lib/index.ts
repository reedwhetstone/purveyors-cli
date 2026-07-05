// Barrel export — re-exports all lib modules for convenience.
// Usage: import { searchCatalog, listInventory } from '@purveyors/cli/lib'
// Or use individual subpath imports:
//   import { searchCatalog } from '@purveyors/cli/catalog'
//   import { listInventory } from '@purveyors/cli/inventory'

export * from './catalog.js';
export * from './inventory.js';
export * from './manifest.js';
export * from './market.js';
export * from './roast.js';
export * from './sales.js';
export * from './tasting.js';
