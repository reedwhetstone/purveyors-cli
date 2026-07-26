import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import type { MilestoneData, ProcessedRoastData } from './artisan/types.js';
import { POSTGRES_INT4_MAX } from './strict-number.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoastProfile {
  roast_id: number;
  batch_name: string | null;
  coffee_id: number | null;
  coffee_name: string | null;
  roast_date: string | null;
  oz_in: number | null;
  oz_out: number | null;
  weight_loss_percent: number | null;
  roast_notes: string | null;
  roast_targets?: string | null;
  user: string;
  last_updated: string;
  roaster_type: string | null;
  roaster_size: string | null;
  temperature_unit: string | null;
  charge_time: number | null;
  drop_time: number | null;
  fc_start_time: number | null;
  fc_end_time: number | null;
  fc_start_temp: number | null;
  fc_end_temp: number | null;
  drop_temp: number | null;
  charge_temp: number | null;
  tp_time: number | null;
  tp_temp: number | null;
  total_ror: number | null;
  dry_percent: number | null;
  maillard_percent: number | null;
  development_percent: number | null;
  auc: number | null;
  dry_phase_ror: number | null;
  mid_phase_ror: number | null;
  finish_phase_ror: number | null;
  dry_phase_delta_temp: number | null;
  total_roast_time: number | null;
  data_source: string | null;
  roast_uuid: string | null;
  temperatures?: TemperatureEntry[];
  events?: RoastEventEntry[];
}

export interface TemperatureEntry {
  roast_id: number;
  time_seconds: number;
  bean_temp: number | null;
  environmental_temp: number | null;
}

export interface RoastEventEntry {
  roast_id: number;
  time_seconds: number;
  event_type: number | null;
  event_value: string | null;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const listRoastsSchema = z.object({
  coffee_id: z
    .number()
    .int()
    .min(1)
    .max(POSTGRES_INT4_MAX)
    .optional()
    .describe('Filter by green coffee inventory ID'),
  roast_id: z
    .number()
    .int()
    .min(1)
    .max(POSTGRES_INT4_MAX)
    .optional()
    .describe('Filter by roast profile ID'),
  batch_name: z
    .string()
    .optional()
    .describe('Filter by batch name (partial match, case-insensitive)'),
  coffee_name: z
    .string()
    .optional()
    .describe('Filter by bean name (partial match, case-insensitive)'),
  date_start: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only show roasts on or after this date'),
  date_end: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only show roasts on or before this date'),
  stocked_only: z.boolean().optional().describe('Only show roasts for currently stocked beans'),
  catalog_id: z
    .number()
    .int()
    .min(1)
    .max(POSTGRES_INT4_MAX)
    .optional()
    .describe('Filter by coffee_catalog ID (cross-reference from catalog search)'),
  limit: z.number().int().min(1).default(20).describe('Maximum results to return'),
  offset: z.number().int().min(0).optional().describe('Skip N results (for pagination)'),
});

export type ListRoastsInput = z.input<typeof listRoastsSchema>;

export const getRoastSchema = z.object({
  id: z.number().int().min(1).max(POSTGRES_INT4_MAX),
  includeTemps: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
});

export type GetRoastInput = z.input<typeof getRoastSchema>;

export const createRoastSchema = z.object({
  coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX),
  batchName: z.string().optional(),
  ozIn: z.number().positive().optional(),
  ozOut: z.number().positive().optional(),
  roastDate: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateRoastInput = z.input<typeof createRoastSchema>;

export const deleteRoastSchema = z.object({
  id: z.number().int().min(1).max(POSTGRES_INT4_MAX),
});

export type DeleteRoastInput = z.input<typeof deleteRoastSchema>;

export const updateRoastSchema = z
  .object({
    notes: z.string().optional(),
    ozOut: z.number().positive().optional(),
    batchName: z.string().optional(),
    targets: z.string().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message: 'No update fields provided. Pass at least one of: notes, ozOut, batchName, targets.',
  });

export type UpdateRoastInput = z.input<typeof updateRoastSchema>;

// ─── Pure lib functions ───────────────────────────────────────────────────────

export async function listRoasts(
  opts: ListRoastsInput,
  tokenOverride?: string
): Promise<RoastProfile[]> {
  const parsed = listRoastsSchema.parse(opts);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.list(parsed), 'Roast list');
  return envelope.data as RoastProfile[];
}

export async function getRoast(
  id: number,
  opts: { includeTemps?: boolean; includeEvents?: boolean } = {},
  tokenOverride?: string
): Promise<RoastProfile> {
  getRoastSchema.parse({ id, ...opts });
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.get(String(id), opts), `Roast ${id}`);
  return envelope.data as RoastProfile;
}

export async function createRoast(
  input: CreateRoastInput,
  tokenOverride?: string
): Promise<RoastProfile> {
  const parsed = createRoastSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roasts.create(parsed, { idempotencyKey: randomUUID() }),
    'Roast create'
  );
  return envelope.data as RoastProfile;
}

export async function deleteRoast(id: number, tokenOverride?: string): Promise<void> {
  deleteRoastSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  unwrapParchment(await client.roasts.delete(id), `Roast ${id} delete`);
}

export async function updateRoast(
  id: number,
  input: UpdateRoastInput,
  tokenOverride?: string
): Promise<RoastProfile> {
  deleteRoastSchema.parse({ id });
  const parsed = updateRoastSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.update(id, parsed), `Roast ${id} update`);
  return envelope.data as RoastProfile;
}

export async function replaceRoastArtisanImport(
  id: number,
  input: { fileName: string; fileContent: string; fileSize?: number },
  tokenOverride?: string
): Promise<RoastProfile> {
  deleteRoastSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roasts.replaceArtisanImport(id, input),
    `Roast ${id} Artisan import replace`
  );
  return envelope.data.roast as RoastProfile;
}

export async function clearRoastArtisanImport(
  id: number,
  tokenOverride?: string
): Promise<{ id: number; deletedCounts: Record<string, number>; batchName: string | null }> {
  deleteRoastSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roasts.clearArtisanImport(id),
    `Roast ${id} Artisan import clear`
  );
  return envelope.data;
}

// ─── Roast import from .alog file ─────────────────────────────────────────────

export const importRoastSchema = z.object({
  fileContent: z.string().min(1),
  fileName: z.string().min(1),
  coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX),
  batchName: z.string().optional(),
  ozIn: z.number().positive().optional(),
  roastNotes: z.string().optional(),
  roastTargets: z.string().optional(),
});

export type ImportRoastInput = z.input<typeof importRoastSchema>;

export interface ImportRoastResult {
  success: boolean;
  message: string;
  milestones: MilestoneData;
  phases: ProcessedRoastData['phases'];
  total_time: number;
  temperature_unit: 'F' | 'C';
  milestone_events: number;
  control_events: number;
  roast_id: number;
  batch_name: string;
  coffee_name: string;
  coffee_id: number;
}

/**
 * Extract the input weight in ounces from an Artisan .alog weight array.
 * Falls back to undefined if weight data is absent or unparseable.
 *
 * @param weight - The `weight` field from ArtisanRoastData: [input, output, unit]
 */
export function extractOzFromAlog(
  weight: [number, number, string] | undefined
): number | undefined {
  if (!weight || !Array.isArray(weight) || weight.length < 3) return undefined;
  const [inputWeight, , unit] = weight;
  if (typeof inputWeight !== 'number' || inputWeight <= 0) return undefined;
  if (typeof unit !== 'string') return undefined;

  const unitLower = unit.toLowerCase();
  if (unitLower === 'g' || unitLower === 'gr' || unitLower === 'gram' || unitLower === 'grams') {
    return inputWeight / 28.3495;
  }
  if (unitLower === 'oz' || unitLower === 'ounce' || unitLower === 'ounces') {
    return inputWeight;
  }
  if (unitLower === 'kg' || unitLower === 'kilogram' || unitLower === 'kilograms') {
    return inputWeight * 35.274;
  }
  if (
    unitLower === 'lb' ||
    unitLower === 'lbs' ||
    unitLower === 'pound' ||
    unitLower === 'pounds'
  ) {
    return inputWeight * 16;
  }
  // Unknown unit — return undefined rather than a wrong number
  return undefined;
}

/**
 * Generate a default batch name: "{coffee_name} {YYYY-MM-DD}".
 */
export function defaultBatchName(coffeeName: string, dateIso: string): string {
  return `${coffeeName} ${dateIso}`;
}

// NOTE: The legacy direct-to-Parchment importer `importRoastFromFile` was
// removed once `purvey roast import` and `purvey roast watch` both moved to the
// canonical Parchment API (`client.roasts.import`), which parses the raw `.alog`
// and persists the curve + events server-side. The pure helpers below
// (`importRoastSchema`, `extractOzFromAlog`, `defaultBatchName`,
// `ImportRoastResult`) remain the stable contract for that SDK-backed path.
