/**
 * Temperature conversion utilities for Artisan roast data
 */

export type TemperatureUnit = 'F' | 'C';

/**
 * Convert temperature between Fahrenheit and Celsius
 */
export function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit
): number {
  if (from === to) return value;

  if (from === 'F' && to === 'C') {
    return ((value - 32) * 5) / 9;
  } else {
    return (value * 9) / 5 + 32;
  }
}

/**
 * Convert temperature array with safe null handling
 */
export function convertTemperatureArray(
  values: (number | null)[],
  from: TemperatureUnit,
  to: TemperatureUnit
): (number | null)[] {
  if (from === to) return values;

  return values.map((value) => {
    if (value === null || value === undefined) return null;
    return convertTemperature(value, from, to);
  });
}

/**
 * Format temperature value with unit for display
 */
export function formatTemperature(
  value: number | null,
  unit: TemperatureUnit,
  displayUnit?: TemperatureUnit,
  precision: number = 1
): string {
  if (value === null || value === undefined) return '--';

  const displayValue =
    displayUnit && displayUnit !== unit ? convertTemperature(value, unit, displayUnit) : value;

  return `${displayValue.toFixed(precision)}°${displayUnit || unit}`;
}

/**
 * Get temperature range for scale calculation
 */
export function getTemperatureRange(
  beanTemps: (number | null)[],
  envTemps: (number | null)[],
  padding: number = 50
): [number, number] {
  const allTemps = [...beanTemps, ...envTemps].filter((t) => t !== null) as number[];

  if (allTemps.length === 0) {
    return [0, 500]; // Default range
  }

  const min = Math.min(...allTemps);
  const max = Math.max(...allTemps);

  return [min - padding, max + padding];
}

/**
 * Normalize temperature data to a target unit
 * This is the main function for processing Artisan data
 *
 * IMPORTANT: In Artisan .alog files:
 * - temp1 = Environmental Temperature (ET)
 * - temp2 = Bean Temperature (BT)
 */
export function normalizeArtisanTemperatures(
  temp1: number[], // Environmental Temperature (ET) - from Artisan temp1 array
  temp2: number[], // Bean Temperature (BT) - from Artisan temp2 array
  sourceUnit: TemperatureUnit,
  targetUnit: TemperatureUnit = 'F'
): {
  beanTemps: number[];
  envTemps: number[];
  unit: TemperatureUnit;
} {
  return {
    beanTemps: temp2.map((t) => convertTemperature(t, sourceUnit, targetUnit)), // temp2 = BT
    envTemps: temp1.map((t) => convertTemperature(t, sourceUnit, targetUnit)), // temp1 = ET
    unit: targetUnit,
  };
}

/**
 * Safe temperature parsing with validation
 */
export function parseTemperature(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = typeof value === 'number' ? value : parseFloat(String(value));

  // Check for invalid values that Artisan might export
  if (isNaN(parsed) || parsed === -1.0 || parsed < -273.15 || parsed > 1000) {
    return null;
  }

  return parsed;
}

/**
 * Validate temperature unit
 */
export function isValidTemperatureUnit(unit: unknown): unit is TemperatureUnit {
  return unit === 'F' || unit === 'C';
}

/**
 * Get default temperature unit based on locale/region
 */
export function getDefaultTemperatureUnit(): TemperatureUnit {
  // Default to Fahrenheit for coffee roasting (most common)
  return 'F';
}

/**
 * Convert Artisan mode field to temperature unit
 */
export function artisanModeToUnit(mode: string): TemperatureUnit {
  if (mode === 'C') return 'C';
  return 'F'; // Default to Fahrenheit if not explicitly Celsius
}
