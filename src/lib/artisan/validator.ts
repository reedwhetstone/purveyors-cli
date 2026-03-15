import type { ValidationResult } from './types.js';
import { isValidTemperatureUnit } from './temperature.js';

/**
 * Comprehensive validation for Artisan .alog.json files
 */
export function validateArtisanData(inputData: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = inputData as Record<string, unknown>;

  // Basic structure validation
  if (!data || typeof data !== 'object') {
    errors.push('Invalid file format: Expected JSON object');
    return { valid: false, errors, warnings };
  }

  // Required time series arrays
  if (!data.timex || !Array.isArray(data.timex)) {
    errors.push('Missing or invalid time data (timex array)');
  } else if (data.timex.length === 0) {
    errors.push('Empty time data array');
  }

  if (!data.temp1 || !Array.isArray(data.temp1)) {
    errors.push('Missing or invalid bean temperature data (temp1 array)');
  } else if (data.temp1.length === 0) {
    errors.push('Empty bean temperature data array');
  }

  if (!data.temp2 || !Array.isArray(data.temp2)) {
    errors.push('Missing or invalid environmental temperature data (temp2 array)');
  } else if (data.temp2.length === 0) {
    errors.push('Empty environmental temperature data array');
  }

  // Array length consistency
  if (data.timex && data.temp1 && data.temp2) {
    const timex = data.timex as unknown[];
    const temp1 = data.temp1 as unknown[];
    const temp2 = data.temp2 as unknown[];

    const timeLength = timex.length;
    const temp1Length = temp1.length;
    const temp2Length = temp2.length;

    if (timeLength !== temp1Length) {
      errors.push(
        `Time and bean temperature data length mismatch (${timeLength} vs ${temp1Length})`
      );
    }

    if (timeLength !== temp2Length) {
      errors.push(
        `Time and environmental temperature data length mismatch (${timeLength} vs ${temp2Length})`
      );
    }

    // Reasonable data size check
    if (timeLength > 10000) {
      warnings.push(`Large dataset detected (${timeLength} points). Import may take longer.`);
    }

    if (timeLength < 10) {
      warnings.push(
        `Small dataset detected (${timeLength} points). Verify this is a complete roast.`
      );
    }
  }

  // Milestone data validation
  if (!data.timeindex || !Array.isArray(data.timeindex)) {
    errors.push('Missing or invalid milestone data (timeindex array)');
  } else {
    if (data.timeindex.length !== 8) {
      warnings.push(`Unexpected milestone array length (${data.timeindex.length}, expected 8)`);
    }

    // Validate milestone indices are within time array bounds
    if (data.timex && Array.isArray(data.timex)) {
      const timex = data.timex as unknown[];
      const maxIndex = timex.length - 1;
      (data.timeindex as number[]).forEach((index: number, i: number) => {
        if (index > 0 && index > maxIndex) {
          errors.push(`Milestone index ${i} (${index}) exceeds time data length (${maxIndex})`);
        }
      });
    }

    // Check for reasonable milestone progression
    const nonZeroMilestones = data.timeindex.filter((idx: number) => idx > 0);
    if (nonZeroMilestones.length > 1) {
      for (let i = 1; i < nonZeroMilestones.length; i++) {
        if (nonZeroMilestones[i] <= nonZeroMilestones[i - 1]) {
          warnings.push('Milestone events may not be in chronological order');
          break;
        }
      }
    }
  }

  // Temperature unit validation
  if (!data.mode || !isValidTemperatureUnit(data.mode)) {
    warnings.push('Missing or invalid temperature unit (mode). Defaulting to Fahrenheit.');
  }

  // Metadata validation
  if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
    warnings.push('Missing or empty roast title');
  }

  if (!data.roastertype || typeof data.roastertype !== 'string') {
    warnings.push('Missing roaster type information');
  }

  // Weight data validation
  if (data.weight) {
    if (!Array.isArray(data.weight) || data.weight.length !== 3) {
      warnings.push('Invalid weight data format (expected [input, output, unit])');
    } else {
      const [input, output, unit] = data.weight;
      if (typeof input !== 'number' || input <= 0) {
        warnings.push('Invalid input weight value');
      }
      if (typeof output !== 'number' || output <= 0) {
        warnings.push('Invalid output weight value');
      }
      if (typeof unit !== 'string') {
        warnings.push('Invalid weight unit');
      }
      if (typeof input === 'number' && typeof output === 'number' && output > input) {
        warnings.push('Output weight exceeds input weight (possible data error)');
      }
    }
  } else {
    warnings.push('Missing weight data');
  }

  // Temperature data reasonableness checks
  if (data.temp1 && Array.isArray(data.temp1)) {
    const beanTemps = data.temp1.filter(
      (t: unknown) => typeof t === 'number' && !isNaN(t)
    ) as number[];
    if (beanTemps.length > 0) {
      const minBT = Math.min(...beanTemps);
      const maxBT = Math.max(...beanTemps);

      // Check for reasonable temperature ranges
      const unit = data.mode || 'F';
      if (unit === 'F') {
        if (minBT < 100 || maxBT > 600) {
          warnings.push(`Bean temperatures outside typical range (${minBT}°F - ${maxBT}°F)`);
        }
      } else {
        if (minBT < 38 || maxBT > 315) {
          warnings.push(`Bean temperatures outside typical range (${minBT}°C - ${maxBT}°C)`);
        }
      }
    }
  }

  if (data.temp2 && Array.isArray(data.temp2)) {
    const envTemps = data.temp2.filter(
      (t: unknown) => typeof t === 'number' && !isNaN(t)
    ) as number[];
    if (envTemps.length > 0) {
      const minET = Math.min(...envTemps);
      const maxET = Math.max(...envTemps);

      // Environmental temp should generally be higher than bean temp
      const unit = data.mode || 'F';
      if (unit === 'F') {
        if (minET < 200 || maxET > 800) {
          warnings.push(
            `Environmental temperatures outside typical range (${minET}°F - ${maxET}°F)`
          );
        }
      } else {
        if (minET < 93 || maxET > 427) {
          warnings.push(
            `Environmental temperatures outside typical range (${minET}°C - ${maxET}°C)`
          );
        }
      }
    }
  }

  // Time data validation
  if (data.timex && Array.isArray(data.timex)) {
    const times = data.timex.filter((t: unknown) => typeof t === 'number' && !isNaN(t)) as number[];
    if (times.length > 0) {
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const duration = maxTime - minTime;

      if (minTime < 0) {
        warnings.push('Negative time values detected');
      }

      if (duration < 60) {
        warnings.push(`Very short roast duration (${duration.toFixed(1)} seconds)`);
      }

      if (duration > 3600) {
        warnings.push(`Very long roast duration (${duration.toFixed(1)} seconds)`);
      }

      // Check for time sequence consistency
      for (let i = 1; i < times.length; i++) {
        if (times[i] < times[i - 1]) {
          warnings.push('Time sequence is not monotonically increasing');
          break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Quick validation for file upload (lighter check)
 */
export function validateArtisanFileStructure(inputData: unknown): ValidationResult {
  const errors: string[] = [];
  const data = inputData as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    errors.push('Invalid JSON structure');
    return { valid: false, errors };
  }

  // Essential field check
  const requiredFields = ['timex', 'temp1', 'temp2', 'timeindex'];
  for (const field of requiredFields) {
    if (!Array.isArray(data[field])) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate processed data before database insertion
 */
export function validateProcessedData(processedData: object): ValidationResult {
  const data = processedData as Record<string, unknown>;
  const errors: string[] = [];

  if (!data.profileData) {
    errors.push('Missing profile data');
  }

  if (!data.temperatureData || !Array.isArray(data.temperatureData)) {
    errors.push('Missing or invalid temperature points');
  } else if (data.temperatureData.length === 0) {
    errors.push('No temperature points to insert');
  }

  if (!data.milestones) {
    errors.push('Missing milestone data');
  }

  return { valid: errors.length === 0, errors };
}
