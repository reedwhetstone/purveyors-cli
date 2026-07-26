import { z } from 'zod';
import { PrvrsError } from './errors.js';
import { getInventory, type InventoryItem } from './inventory.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { parseStrictInteger } from './strict-number.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TastingFilter = 'user' | 'supplier' | 'both';

export interface SupplierTastingNotes {
  source: 'supplier';
  catalogId: number;
  name: string | null;
  processing: string | null;
  region: string | null;
  cupping_notes: string | null;
  ai_tasting_notes: unknown | null;
  ai_description: string | null;
}

export interface UserTastingNotes {
  source: 'user';
  inventoryId: number;
  catalogId: number | null;
  cupping_notes: string | null;
  notes: string | null;
}

export interface TastingData {
  beanId: number;
  filter: TastingFilter;
  supplier: SupplierTastingNotes | null;
  user: UserTastingNotes | null;
}

export interface CuppingNotes {
  aroma?: number;
  body?: number;
  acidity?: number;
  sweetness?: number;
  aftertaste?: number;
  brew_method?: string;
  notes?: string;
  rated_at?: string;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const tastingFilterSchema = z.enum(['user', 'supplier', 'both']);

export const getTastingNotesSchema = z.object({
  bean_id: z.number().int().positive().describe('Required coffee bean ID'),
  filter: tastingFilterSchema.default('both'),
});

export type GetTastingNotesInput = z.input<typeof getTastingNotesSchema>;

export const cuppingScoreSchema = z.number().int().min(1).max(5);

export const rateCoffeeSchema = z.object({
  aroma: cuppingScoreSchema,
  body: cuppingScoreSchema,
  acidity: cuppingScoreSchema,
  sweetness: cuppingScoreSchema,
  aftertaste: cuppingScoreSchema,
  brewMethod: z.string().optional(),
  notes: z.string().optional(),
});

export type RateCoffeeInput = z.input<typeof rateCoffeeSchema>;

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Validate a cupping score is an integer in [1, 5]. */
export function isValidCuppingScore(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Parse and validate a cupping score flag value (for CLI use). */
export function parseCuppingScore(raw: string, flag: string): number {
  const n = parseStrictInteger(raw, 1, 5);
  if (!Number.isFinite(n) || !isValidCuppingScore(n)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `--${flag} must be an integer between 1 and 5 (got "${raw}").`
    );
  }
  return n;
}

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * Get tasting notes for a bean by coffee_catalog ID.
 * Combines supplier notes from coffee_catalog with user notes from green_coffee_inv.
 */
export async function getTastingNotes(
  id: number,
  filter: TastingFilter = 'both'
): Promise<TastingData> {
  getTastingNotesSchema.parse({ bean_id: id, filter });
  const client = await createParchmentClient('member');
  const envelope = unwrapParchment(
    await client.tasting.get(String(id), { filter }),
    'Tasting notes'
  );
  return envelope.data as TastingData;
}

/**
 * Rate an owned inventory lot through the canonical Parchment API.
 */
export async function rateCoffee(
  id: number,
  input: RateCoffeeInput,
  tokenOverride?: string
): Promise<InventoryItem> {
  const parsed = rateCoffeeSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  unwrapParchment(await client.tasting.rate(id, parsed), 'Tasting rate');
  // Preserve the public CLI/helper output contract: callers historically receive
  // the refreshed inventory row rather than the mutation-specific API payload.
  return getInventory(id, tokenOverride);
}
