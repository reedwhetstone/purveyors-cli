/** Canonical inclusive bounds shared by CLI parsing, schemas, and manifest metadata. */
export const CLI_NUMERIC_BOUNDS = {
  catalogSearchLimit: { minimum: 1, maximum: 1000 },
  supplierMinCoffees: { minimum: 1, maximum: 100 },
  marketSignalsLimit: { minimum: 1, maximum: 100 },
  priceIndexLimit: { minimum: 1, maximum: 100 },
  procurementMatchesLimit: { minimum: 1, maximum: 100 },
} as const;
