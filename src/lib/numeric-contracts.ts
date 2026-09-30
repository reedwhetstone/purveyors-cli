/** Canonical inclusive bounds shared by CLI parsing, schemas, and manifest metadata. */
export const CLI_NUMERIC_BOUNDS = {
  catalogSearchLimit: { minimum: 1, maximum: 1000 },
  supplierMinCoffees: { minimum: 1, maximum: 100 },
  marketSignalsLimit: { minimum: 1, maximum: 100 },
  priceIndexLimit: { minimum: 1, maximum: 100 },
  priceIndexHistoryLimit: { minimum: 1, maximum: 10000 },
  priceIndexHistoryWindowDays: { minimum: 1, maximum: 365 },
  procurementMatchesLimit: { minimum: 1, maximum: 100 },
} as const;
