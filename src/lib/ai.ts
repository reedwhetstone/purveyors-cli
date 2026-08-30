import { classifyRoast as classifyRoastFromCherry } from './cherry.js';

export type {
  ClassifyRoastInput,
  ClassifyRoastResult,
  LegacyClassifyAuthFacade,
} from './cherry.js';

/**
 * @deprecated Import `classifyRoast` from `@purveyors/cli/cherry`. This alias
 * remains the exact same callable so existing consumers do not break.
 */
export const classifyRoast = classifyRoastFromCherry;
