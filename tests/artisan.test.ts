import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseAlogFile } from '../src/lib/artisan/parser.js';
import { validateArtisanData } from '../src/lib/artisan/validator.js';
import {
  convertTemperature,
  normalizeArtisanTemperatures,
  artisanModeToUnit,
} from '../src/lib/artisan/temperature.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── parseAlogFile ─────────────────────────────────────────────────────────────

describe('parseAlogFile', () => {
  it('parses a minimal .alog string (Python literal syntax)', () => {
    const fixture = readFileSync(join(__dirname, 'fixtures/test-roast.alog'), 'utf-8');
    const result = parseAlogFile(fixture) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result.title).toBe('Test Roast');
    expect(result.mode).toBe('F');
    expect(result.roastertype).toBe('Bullet R1');
    expect(Array.isArray(result.timex)).toBe(true);
    expect(result.timex).toEqual([0, 30, 60, 90, 120]);
    expect(result.temp1).toEqual([350, 360, 370, 380, 390]);
    expect(result.temp2).toEqual([200, 250, 300, 350, 380]);
    expect(result.timeindex).toEqual([0, -1, 3, -1, -1, -1, 4, -1]);
  });

  it('converts Python True/False/None to JSON equivalents', () => {
    const alogContent = `{'title': 'Test', 'mode': 'F', 'roastertype': 'Test', 'timex': [0, 30, 60], 'temp1': [350, 360, 370], 'temp2': [200, 250, 300], 'timeindex': [0, -1, -1, -1, -1, -1, 2, -1], 'flag': True, 'other': False, 'val': None}`;
    const result = parseAlogFile(alogContent) as Record<string, unknown>;

    expect(result.flag).toBe(true);
    expect(result.other).toBe(false);
    expect(result.val).toBeNull();
  });

  it('throws on empty input', () => {
    expect(() => parseAlogFile('')).toThrow();
  });

  it('throws when required arrays are missing', () => {
    const alogContent = `{'title': 'Test', 'mode': 'F', 'roastertype': 'Test'}`;
    expect(() => parseAlogFile(alogContent)).toThrow(/Missing required temperature array/);
  });

  it('throws when timex array is empty', () => {
    const alogContent = `{'title': 'Test', 'mode': 'F', 'roastertype': 'Test', 'timex': [], 'temp1': [], 'temp2': []}`;
    expect(() => parseAlogFile(alogContent)).toThrow(/No profile data found/);
  });
});

// ── validateArtisanData ───────────────────────────────────────────────────────

describe('validateArtisanData', () => {
  const validData = {
    title: 'Test Roast',
    mode: 'F',
    roastertype: 'Bullet R1',
    timex: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300],
    temp1: [350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450],
    temp2: [200, 250, 300, 350, 380, 400, 410, 420, 430, 440, 450],
    timeindex: [0, -1, 8, -1, -1, -1, 10, -1],
    weight: [16, 13.5, 'oz'],
  };

  it('returns valid for well-formed data', () => {
    const result = validateArtisanData(validData);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid when timex is missing', () => {
    const data = { ...validData, timex: undefined };
    const result = validateArtisanData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('timex'))).toBe(true);
  });

  it('returns invalid when temp1 is missing', () => {
    const data = { ...validData, temp1: undefined };
    const result = validateArtisanData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('temp1'))).toBe(true);
  });

  it('returns invalid when arrays have mismatched lengths', () => {
    const data = { ...validData, temp1: [350, 360] }; // shorter than timex
    const result = validateArtisanData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('mismatch'))).toBe(true);
  });

  it('returns invalid for null input', () => {
    const result = validateArtisanData(null);
    expect(result.valid).toBe(false);
  });

  it('returns warnings for missing weight data', () => {
    const data = { ...validData, weight: undefined };
    const result = validateArtisanData(data);
    expect(result.warnings?.some((w) => w.includes('weight'))).toBe(true);
  });
});

// ── convertTemperature ────────────────────────────────────────────────────────

describe('convertTemperature', () => {
  it('converts 32°F to 0°C', () => {
    expect(convertTemperature(32, 'F', 'C')).toBeCloseTo(0);
  });

  it('converts 212°F to 100°C', () => {
    expect(convertTemperature(212, 'F', 'C')).toBeCloseTo(100);
  });

  it('converts 0°C to 32°F', () => {
    expect(convertTemperature(0, 'C', 'F')).toBeCloseTo(32);
  });

  it('converts 100°C to 212°F', () => {
    expect(convertTemperature(100, 'C', 'F')).toBeCloseTo(212);
  });

  it('returns the same value when from === to', () => {
    expect(convertTemperature(350, 'F', 'F')).toBe(350);
    expect(convertTemperature(175, 'C', 'C')).toBe(175);
  });

  it('handles a typical roasting temperature (400°F → ~204°C)', () => {
    expect(convertTemperature(400, 'F', 'C')).toBeCloseTo(204.44, 1);
  });
});

// ── normalizeArtisanTemperatures ──────────────────────────────────────────────

describe('normalizeArtisanTemperatures', () => {
  it('swaps ET/BT correctly (temp1=ET, temp2=BT)', () => {
    // In Artisan: temp1=ET (environmental), temp2=BT (bean)
    const temp1 = [350, 360, 370]; // ET
    const temp2 = [200, 250, 300]; // BT
    const result = normalizeArtisanTemperatures(temp1, temp2, 'F', 'F');

    // beanTemps should come from temp2, envTemps from temp1
    expect(result.beanTemps).toEqual([200, 250, 300]);
    expect(result.envTemps).toEqual([350, 360, 370]);
    expect(result.unit).toBe('F');
  });

  it('converts from Celsius to Fahrenheit', () => {
    const temp1 = [175]; // ET in C
    const temp2 = [100]; // BT in C
    const result = normalizeArtisanTemperatures(temp1, temp2, 'C', 'F');

    expect(result.beanTemps[0]).toBeCloseTo(212);
    expect(result.envTemps[0]).toBeCloseTo(347);
    expect(result.unit).toBe('F');
  });

  it('defaults targetUnit to F', () => {
    const temp1 = [350];
    const temp2 = [200];
    const result = normalizeArtisanTemperatures(temp1, temp2, 'F');
    expect(result.unit).toBe('F');
  });
});

// ── artisanModeToUnit ─────────────────────────────────────────────────────────

describe('artisanModeToUnit', () => {
  it('returns C for mode "C"', () => {
    expect(artisanModeToUnit('C')).toBe('C');
  });

  it('returns F for mode "F"', () => {
    expect(artisanModeToUnit('F')).toBe('F');
  });

  it('defaults to F for unknown modes', () => {
    expect(artisanModeToUnit('K')).toBe('F');
    expect(artisanModeToUnit('')).toBe('F');
    expect(artisanModeToUnit('celsius')).toBe('F');
  });
});
