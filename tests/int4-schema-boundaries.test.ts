import { describe, expect, it } from 'vitest';
import {
  findSimilarBeansSchema,
  getCatalogSchema,
  getCatalogSimilaritySchema,
  searchCatalogSchema,
  supplierAggregateSchema,
  SUPPLIER_MIN_COFFEES_MAX,
} from '../src/lib/catalog.js';
import {
  addInventorySchema,
  deleteInventorySchema,
  getInventorySchema,
  listInventorySchema,
} from '../src/lib/inventory.js';
import {
  createRoastSchema,
  deleteRoastSchema,
  getRoastSchema,
  importRoastSchema,
  listRoastsSchema,
} from '../src/lib/roast.js';
import { deleteSaleSchema, listSalesSchema, saleTargetSelectorSchema } from '../src/lib/sales.js';
import { getTastingNotesSchema } from '../src/lib/tasting.js';
import { POSTGRES_INT4_MAX } from '../src/lib/strict-number.js';

const overflow = POSTGRES_INT4_MAX + 1;

const cases = [
  ['catalog search IDs', searchCatalogSchema, { ids: [overflow] }],
  ['catalog get ID', getCatalogSchema, { id: overflow }],
  ['catalog similarity ID', getCatalogSimilaritySchema, { coffee_id: overflow }],
  ['similar beans ID', findSimilarBeansSchema, { coffee_id: overflow }],
  ['supplier minimum count', supplierAggregateSchema, { minCoffees: SUPPLIER_MIN_COFFEES_MAX + 1 }],
  ['inventory list catalog ID', listInventorySchema, { catalogId: overflow }],
  ['inventory get ID', getInventorySchema, { id: overflow }],
  ['inventory add catalog ID', addInventorySchema, { catalogId: overflow, qty: 1 }],
  ['inventory delete ID', deleteInventorySchema, { id: overflow }],
  ['roast list IDs', listRoastsSchema, { coffee_id: overflow }],
  ['roast get ID', getRoastSchema, { id: overflow }],
  ['roast create inventory ID', createRoastSchema, { coffeeId: overflow }],
  ['roast delete ID', deleteRoastSchema, { id: overflow }],
  [
    'roast import inventory ID',
    importRoastSchema,
    { fileContent: 'data', fileName: 'roast.alog', coffeeId: overflow },
  ],
  ['sales list inventory ID', listSalesSchema, { greenCoffeeInvId: overflow }],
  ['sales target roast ID', saleTargetSelectorSchema, { roastId: overflow }],
  ['sale delete ID', deleteSaleSchema, { id: overflow }],
  ['tasting catalog ID', getTastingNotesSchema, { bean_id: overflow }],
] as const;

describe('exported ID schema boundaries', () => {
  it.each(cases)('rejects out-of-range %s', (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('accepts the PostgreSQL int4 maximum for IDs', () => {
    expect(getCatalogSchema.parse({ id: POSTGRES_INT4_MAX }).id).toBe(POSTGRES_INT4_MAX);
    expect(getInventorySchema.parse({ id: POSTGRES_INT4_MAX }).id).toBe(POSTGRES_INT4_MAX);
    expect(getRoastSchema.parse({ id: POSTGRES_INT4_MAX }).id).toBe(POSTGRES_INT4_MAX);
    expect(deleteSaleSchema.parse({ id: POSTGRES_INT4_MAX }).id).toBe(POSTGRES_INT4_MAX);
  });

  it('accepts the supplier minimum count maximum', () => {
    expect(supplierAggregateSchema.parse({ minCoffees: SUPPLIER_MIN_COFFEES_MAX }).minCoffees).toBe(
      SUPPLIER_MIN_COFFEES_MAX
    );
  });
});
