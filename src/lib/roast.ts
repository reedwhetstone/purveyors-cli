import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { components } from '@purveyors/sdk';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { POSTGRES_INT4_MAX } from './strict-number.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RoastListProfile = components['schemas']['RoastListResource'];
export type RoastDetailProfile = components['schemas']['RoastDetailResource'];
/** Backward-compatible detail-shaped alias for existing CLI consumers. */
export type RoastProfile = RoastDetailProfile;
export type TemperatureEntry = components['schemas']['RoastTemperature'];
export type RoastEventEntry = components['schemas']['RoastEvent'];
export type RoastChartDataResponse = components['schemas']['RoastChartDataResponse'];
/** A roast batch: one roasting session with its own id, display name, and date. */
export type RoastBatch = components['schemas']['RoastBatchResource'];
export type RoastBatchDeleteResult =
  components['schemas']['RoastBatchRecordDeleteResponse']['data'];

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** A batch is identified by its id; batch names may repeat. */
const roastBatchIdSchema = z.string().uuid();

/** Batch names are matched exactly as sent, so they are checked rather than trimmed. */
const roastBatchNameSchema = z
  .string()
  .max(255, 'Batch name must be at most 255 characters')
  .refine((value) => value.trim() !== '', 'Batch name cannot be blank');

/** Validate a roast batch id before making an owner-scoped API call. */
export function parseRoastBatchId(value: string, label: string): string {
  const parsed = roastBatchIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${label}: expected a batch ID (UUID). Find one with 'purvey roast-batch list'.`
    );
  }
  return parsed.data;
}

/**
 * A roast joins an existing batch by id, or is placed by name. Passing both is
 * refused: the batch already has a name, and renaming it is a separate command.
 */
function refuseBatchIdWithName(
  value: { batchId?: string; batchName?: string },
  ctx: z.RefinementCtx
) {
  if (value.batchId !== undefined && value.batchName !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['batchName'],
      message:
        "Use either batchId or batchName, not both. A roast placed by batchId takes that batch's name.",
    });
  }
}

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
  batch_id: roastBatchIdSchema
    .optional()
    .describe('Filter to the roasts in one batch, by batch ID'),
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

/** Bounds published by Parchment for `/v1/roasts/{id}/chart-data?target_points=`. */
export const ROAST_CHART_TARGET_POINTS = { minimum: 50, maximum: 1000 } as const;

export const getRoastChartDataSchema = z.object({
  id: z.number().int().min(1).max(POSTGRES_INT4_MAX),
  targetPoints: z
    .number()
    .int()
    .min(ROAST_CHART_TARGET_POINTS.minimum)
    .max(ROAST_CHART_TARGET_POINTS.maximum)
    .optional(),
});

export type GetRoastChartDataInput = z.input<typeof getRoastChartDataSchema>;

export const createRoastSchema = z
  .object({
    coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX),
    batchId: roastBatchIdSchema.optional(),
    batchName: z.string().optional(),
    ozIn: z.number().positive().optional(),
    ozOut: z.number().positive().optional(),
    roastDate: z.string().optional(),
    notes: z.string().optional(),
    targets: z.string().optional(),
    roasterType: z.string().optional(),
  })
  .superRefine(refuseBatchIdWithName);

export type CreateRoastInput = z.input<typeof createRoastSchema>;

/** Body Parchment accepts for creating a roast from an uploaded reference's stored file. */
export const createRoastFromReferenceSchema = z
  .object({
    referenceProfileId: z.string().uuid(),
    referenceRevisionId: z.string().uuid(),
    coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX),
    batchId: roastBatchIdSchema.optional(),
    batchName: z.string().optional(),
    roastDate: z.string().regex(DATE_REGEX).optional(),
    ozIn: z.number().positive().optional(),
    ozOut: z.number().positive().optional(),
    roastNotes: z.string().optional(),
    roastTargets: z.string().optional(),
  })
  .superRefine(refuseBatchIdWithName);

export type CreateRoastFromReferenceInput = z.input<typeof createRoastFromReferenceSchema>;
export type RoastImportFromReferenceResponse =
  components['schemas']['RoastImportFromReferenceResponse'];

export const deleteRoastSchema = z.object({
  id: z.number().int().min(1).max(POSTGRES_INT4_MAX),
});

export type DeleteRoastInput = z.input<typeof deleteRoastSchema>;

export const updateRoastSchema = z
  .object({
    notes: z.string().optional(),
    ozOut: z.number().positive().optional(),
    batchId: roastBatchIdSchema.optional(),
    batchName: z.string().optional(),
    targets: z.string().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message:
      'No update fields provided. Pass at least one of: notes, ozOut, batchId, batchName, targets.',
  })
  .superRefine(refuseBatchIdWithName);

export type UpdateRoastInput = z.input<typeof updateRoastSchema>;

// ─── Pure lib functions ───────────────────────────────────────────────────────

export async function listRoasts(
  opts: ListRoastsInput,
  tokenOverride?: string
): Promise<RoastListProfile[]> {
  const parsed = listRoastsSchema.parse(opts);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.list(parsed), 'Roast list');
  return envelope.data;
}

export async function getRoast(
  id: number,
  opts: { includeTemps?: boolean; includeEvents?: boolean } = {},
  tokenOverride?: string
): Promise<RoastDetailProfile> {
  getRoastSchema.parse({ id, ...opts });
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.get(String(id), opts), `Roast ${id}`);
  return envelope.data;
}

/**
 * Fetch Parchment's sampled chart model for one owned roast. The canonical
 * envelope is returned unchanged: series, events, and metadata (including the
 * immutable `metadata.revision` used by profile comparisons).
 */
export async function getRoastChartData(
  input: GetRoastChartDataInput,
  tokenOverride?: string
): Promise<RoastChartDataResponse> {
  const parsed = getRoastChartDataSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  return unwrapParchment(
    await client.roasts.chartData(
      String(parsed.id),
      parsed.targetPoints === undefined ? undefined : { target_points: parsed.targetPoints }
    ),
    `Roast ${parsed.id} chart data`
  );
}

export async function createRoast(
  input: CreateRoastInput,
  tokenOverride?: string
): Promise<RoastDetailProfile> {
  const parsed = createRoastSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roasts.create(parsed, { idempotencyKey: randomUUID() }),
    'Roast create'
  );
  return envelope.data;
}

/**
 * Record a roast from the Artisan file stored with one of the caller's uploaded
 * reference profiles. Parchment decides which references qualify (a planned
 * profile is never recorded as a roast) and its response is returned unchanged.
 */
export async function createRoastFromReference(
  input: CreateRoastFromReferenceInput,
  idempotencyKey?: string
): Promise<RoastImportFromReferenceResponse> {
  const parsed = createRoastFromReferenceSchema.parse(input);
  const key =
    idempotencyKey === undefined
      ? randomUUID()
      : z.string().trim().min(1).max(255).parse(idempotencyKey);
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.roasts.importFromReference(parsed, { idempotencyKey: key }),
    'roast from-reference'
  );
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
): Promise<RoastDetailProfile> {
  deleteRoastSchema.parse({ id });
  const parsed = updateRoastSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roasts.update(id, parsed), `Roast ${id} update`);
  return envelope.data;
}

export async function replaceRoastArtisanImport(
  id: number,
  input: { fileName: string; fileContent: string; fileSize?: number },
  tokenOverride?: string
): Promise<RoastDetailProfile> {
  deleteRoastSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roasts.replaceArtisanImport(id, input),
    `Roast ${id} Artisan import replace`
  );
  return envelope.data.roast;
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

// ─── Roast batches ────────────────────────────────────────────────────────────

/** Page-size bounds Parchment publishes for the roast batch list. */
export const ROAST_BATCH_LIST_LIMIT = { minimum: 1, maximum: 200 } as const;

export const listRoastBatchesSchema = z.object({
  name: z.string().min(1).optional().describe('Only batches with exactly this name'),
  dateStart: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only batches dated on or after this date'),
  dateEnd: z
    .string()
    .regex(DATE_REGEX, 'Must be YYYY-MM-DD format')
    .optional()
    .describe('Only batches dated on or before this date'),
  includeEmpty: z.boolean().optional().describe('Include batches that hold no roasts'),
  limit: z
    .number()
    .int()
    .min(ROAST_BATCH_LIST_LIMIT.minimum)
    .max(ROAST_BATCH_LIST_LIMIT.maximum)
    .default(20),
  offset: z.number().int().min(0).optional(),
});

export type ListRoastBatchesInput = z.input<typeof listRoastBatchesSchema>;

export const createRoastBatchSchema = z.object({
  name: roastBatchNameSchema,
  batchDate: z.string().regex(DATE_REGEX, 'Must be YYYY-MM-DD format').optional(),
});

export type CreateRoastBatchInput = z.input<typeof createRoastBatchSchema>;

export const updateRoastBatchSchema = z
  .object({
    name: roastBatchNameSchema.optional(),
    batchDate: z.string().regex(DATE_REGEX, 'Must be YYYY-MM-DD format').optional(),
  })
  .refine((value) => value.name !== undefined || value.batchDate !== undefined, {
    message: 'No update fields provided. Pass at least one of: name, batchDate.',
  });

export type UpdateRoastBatchInput = z.input<typeof updateRoastBatchSchema>;

/** List the caller's roast batches, newest batch date first. Empty batches are left out by default. */
export async function listRoastBatches(
  opts: ListRoastBatchesInput = {},
  tokenOverride?: string
): Promise<RoastBatch[]> {
  const parsed = listRoastBatchesSchema.parse(opts);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roastBatches.list({
      name: parsed.name,
      date_start: parsed.dateStart,
      date_end: parsed.dateEnd,
      ...(parsed.includeEmpty ? { include_empty: 'true' as const } : {}),
      limit: parsed.limit,
      offset: parsed.offset,
    }),
    'Roast batch list'
  );
  return envelope.data;
}

export async function getRoastBatch(batchId: string, tokenOverride?: string): Promise<RoastBatch> {
  const id = parseRoastBatchId(batchId, 'batch ID');
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(await client.roastBatches.get(id), `Roast batch ${id}`);
  return envelope.data;
}

/**
 * Open a new, empty roast batch. This always creates a batch: an existing batch
 * with the same name is left alone. Roasts join it by `batchId`.
 */
export async function createRoastBatch(
  input: CreateRoastBatchInput,
  options: { idempotencyKey?: string; tokenOverride?: string } = {}
): Promise<RoastBatch> {
  const parsed = createRoastBatchSchema.parse(input);
  const key =
    options.idempotencyKey === undefined
      ? randomUUID()
      : z.string().trim().min(1).max(255).parse(options.idempotencyKey);
  const client = await createParchmentClient('member', options.tokenOverride);
  const envelope = unwrapParchment(
    await client.roastBatches.create(parsed, key),
    'Roast batch create'
  );
  return envelope.data.batch;
}

/** Rename or re-date a batch. A new name is carried to the batch's roasts and linked sales. */
export async function updateRoastBatch(
  batchId: string,
  input: UpdateRoastBatchInput,
  tokenOverride?: string
): Promise<RoastBatch> {
  const id = parseRoastBatchId(batchId, 'batch ID');
  const parsed = updateRoastBatchSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roastBatches.update(id, parsed),
    `Roast batch ${id} update`
  );
  return envelope.data;
}

/**
 * Delete one batch and the roasts in it. No other batch is touched, whatever its
 * name. Sales recorded against the batch are kept and lose the link.
 */
export async function deleteRoastBatch(
  batchId: string,
  tokenOverride?: string
): Promise<RoastBatchDeleteResult> {
  const id = parseRoastBatchId(batchId, 'batch ID');
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.roastBatches.delete(id),
    `Roast batch ${id} delete`
  );
  return envelope.data;
}

// ─── Roast import from .alog file ─────────────────────────────────────────────

export const importRoastSchema = z
  .object({
    fileContent: z.string().min(1),
    fileName: z.string().min(1),
    coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX),
    batchId: roastBatchIdSchema.optional(),
    batchName: z.string().optional(),
    ozIn: z.number().positive().optional(),
    roastNotes: z.string().optional(),
    roastTargets: z.string().optional(),
  })
  .superRefine(refuseBatchIdWithName);

export type ImportRoastInput = z.input<typeof importRoastSchema>;

export interface MilestoneData {
  charge?: number;
  dry_end?: number;
  fc_start?: number;
  fc_end?: number;
  sc_start?: number;
  sc_end?: number;
  drop?: number;
  cool?: number;
}

export interface RoastPhaseSummary {
  drying_percent: number;
  maillard_percent: number;
  development_percent: number;
  total_time_seconds: number;
}

export interface ImportRoastResult {
  success: boolean;
  message: string;
  milestones: MilestoneData;
  phases: RoastPhaseSummary;
  total_time: number;
  temperature_unit: 'F' | 'C';
  milestone_events: number;
  control_events: number;
  roast_id: number;
  /** The batch the roast was saved in. Batch names may repeat; this id does not. */
  batch_id: string;
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
