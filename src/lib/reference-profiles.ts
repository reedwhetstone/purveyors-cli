import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ParchmentClient, components } from '@purveyors/sdk';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { CLI_NUMERIC_BOUNDS } from './numeric-contracts.js';
import { normalizePathInput } from './path-input.js';
import { POSTGRES_INT4_MAX } from './strict-number.js';

export type ReferenceProfileImportRequest = components['schemas']['ReferenceProfileImportRequest'];
export type ReferenceProfileGenerationRequest =
  components['schemas']['ReferenceProfileGenerationRequest'];
export type ReferenceProfileFromRoastRequest =
  components['schemas']['ReferenceProfileFromRoastRequest'];
export type ProfileComparisonRequest = components['schemas']['ProfileComparisonRequest'];
export type ProfileComparisonInput = ProfileComparisonRequest['left'];
export type ProfileComparisonResponse = components['schemas']['ProfileComparisonResponse'];

export const REFERENCE_PROFILE_SOURCE_MAX_BYTES = 10_000_000;

/** Bounds and default published by Parchment for `POST /v1/profile-comparisons`. */
export const PROFILE_COMPARISON_TARGET_POINTS = {
  minimum: 50,
  maximum: 1000,
  default: 400,
} as const;
export const profileComparisonUnits = ['F', 'C'] as const;
export type ProfileComparisonUnit = (typeof profileComparisonUnits)[number];

const referenceProfileUuidSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(255);
const roastIdSchema = z.number().int().min(1).max(POSTGRES_INT4_MAX);
const roastRevisionSchema = z.string().trim().min(1);
const roastCandidatesLimitSchema = z
  .number()
  .int()
  .min(CLI_NUMERIC_BOUNDS.referenceProfileRoastsLimit.minimum)
  .max(CLI_NUMERIC_BOUNDS.referenceProfileRoastsLimit.maximum);
const roastReferenceDetailsSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

const temperatureAdjustmentSchema = z
  .object({
    kind: z.enum(['bean_temperature', 'environmental_temperature']),
    startMilliseconds: z.number().finite().nonnegative(),
    endMilliseconds: z.number().finite().positive(),
    delta: z
      .number()
      .finite()
      .min(-20)
      .max(20)
      .refine((value) => value !== 0),
  })
  .strict()
  .refine((adjustment) => adjustment.endMilliseconds > adjustment.startMilliseconds, {
    path: ['endMilliseconds'],
    message: 'must be later than startMilliseconds',
  });

const generationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(4000).optional(),
    userGoal: z.string().trim().min(1).max(600).optional(),
    modelRecommendation: z.string().trim().min(1).max(800).optional(),
    userEdits: z.string().trim().min(1).max(800).optional(),
    changes: z
      .object({
        temperatureAdjustments: z.array(temperatureAdjustmentSchema).min(1).max(12),
      })
      .strict(),
  })
  .strict();

const importRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    fileName: z.string().min(1).max(255),
    fileContent: z.string().min(1).max(REFERENCE_PROFILE_SOURCE_MAX_BYTES),
    fileSize: z.number().int().positive().max(REFERENCE_PROFILE_SOURCE_MAX_BYTES),
  })
  .strict();

/** Validate a canonical UUID before making an owner-scoped API call. */
export function parseReferenceProfileId(value: string, label: string): string {
  const parsed = referenceProfileUuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new PrvrsError('INVALID_ARGUMENT', `Invalid ${label}: expected a UUID.`);
  }
  return parsed.data;
}

/** Use one stable non-secret key per immutable write, matching Parchment's header contract. */
export function resolveReferenceProfileIdempotencyKey(value?: string): string {
  return value === undefined ? randomUUID() : idempotencyKeySchema.parse(value);
}

/** Validate the bounded temperature-edit request locally; Parchment remains authoritative. */
export function parseReferenceProfileGenerationRequest(
  value: unknown
): ReferenceProfileGenerationRequest {
  return generationRequestSchema.parse(value);
}

export function parseReferenceProfileImportRequest(value: unknown): ReferenceProfileImportRequest {
  return importRequestSchema.parse(value);
}

/** Write a returned plan without replacing a local file unless explicitly requested. */
export async function writeGeneratedReferenceFile(
  fileContent: string,
  destination: string,
  overwrite = false
): Promise<string> {
  const filePath = normalizePathInput(destination);
  if (!filePath) {
    throw new PrvrsError('INVALID_ARGUMENT', 'The export destination path cannot be blank.');
  }

  const outputPath = resolve(filePath);
  try {
    await writeFile(outputPath, fileContent, {
      encoding: 'utf8',
      flag: overwrite ? 'w' : 'wx',
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `The destination "${outputPath}" already exists. Pass --force to overwrite it.`
      );
    }
    throw error;
  }

  return outputPath;
}

/** Read the JSON edit set used by preview and save without interpreting profile data. */
export async function readReferenceProfileGenerationRequest(
  inputPath: string
): Promise<ReferenceProfileGenerationRequest> {
  const filePath = normalizePathInput(inputPath);
  if (!filePath) {
    throw new PrvrsError('INVALID_ARGUMENT', 'The request file path cannot be blank.');
  }

  const raw = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `The request file "${filePath}" must contain valid JSON.`
    );
  }

  return parseReferenceProfileGenerationRequest(parsed);
}

export async function listReferenceProfiles(includeArchived = false) {
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.list(includeArchived),
    'reference-profile list'
  );
}

export async function getReferenceProfile(id: string) {
  const profileId = parseReferenceProfileId(id, 'profile id');
  const client = await createParchmentClient('member');
  return unwrapParchment(await client.referenceProfiles.get(profileId), 'reference-profile get');
}

export async function getReferenceProfileChart(id: string, revisionId: string) {
  const profileId = parseReferenceProfileId(id, 'profile id');
  const parentRevisionId = parseReferenceProfileId(revisionId, 'revision id');
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.chart(profileId, parentRevisionId),
    'reference-profile chart'
  );
}

export async function importReferenceProfile(
  body: ReferenceProfileImportRequest,
  idempotencyKey?: string
) {
  const key = resolveReferenceProfileIdempotencyKey(idempotencyKey);
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.import(body, key),
    'reference-profile import'
  );
}

export async function previewReferenceProfile(
  id: string,
  revisionId: string,
  body: ReferenceProfileGenerationRequest
) {
  const profileId = parseReferenceProfileId(id, 'profile id');
  const parentRevisionId = parseReferenceProfileId(revisionId, 'revision id');
  const request = parseReferenceProfileGenerationRequest(body);
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.preview(profileId, parentRevisionId, request),
    'reference-profile preview'
  );
}

export async function saveGeneratedReferenceProfile(
  id: string,
  revisionId: string,
  body: ReferenceProfileGenerationRequest,
  idempotencyKey?: string
) {
  const profileId = parseReferenceProfileId(id, 'profile id');
  const parentRevisionId = parseReferenceProfileId(revisionId, 'revision id');
  const request = parseReferenceProfileGenerationRequest(body);
  const key = resolveReferenceProfileIdempotencyKey(idempotencyKey);
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.generate(profileId, parentRevisionId, request, key),
    'reference-profile save'
  );
}

export async function exportGeneratedReferenceProfile(id: string, revisionId: string) {
  const profileId = parseReferenceProfileId(id, 'profile id');
  const generatedRevisionId = parseReferenceProfileId(revisionId, 'revision id');
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.exportGenerated(profileId, generatedRevisionId),
    'reference-profile export'
  );
}

/**
 * A roast's revision token is its `last_updated` value. An explicit token pins the
 * exact revision the caller looked at; without one, the roast's current revision
 * is read from Parchment, which rejects the request if the roast changes before
 * the plan is built.
 */
async function resolveRoastRevision(
  client: ParchmentClient,
  roastId: number,
  roastRevision: string | undefined,
  context: string
): Promise<string> {
  if (roastRevision !== undefined) return roastRevisionSchema.parse(roastRevision);
  const roast = unwrapParchment(await client.roasts.get(String(roastId)), context);
  return roast.data.last_updated;
}

/** List the executed roasts whose Artisan file is on record and can be a plan base. */
export async function listReferenceProfileRoastCandidates(limit?: number) {
  const query =
    limit === undefined ? undefined : { limit: roastCandidatesLimitSchema.parse(limit) };
  const client = await createParchmentClient('member');
  return unwrapParchment(
    await client.referenceProfiles.roastCandidates(query),
    'reference-profile roasts'
  );
}

/**
 * Preview a plan built on an executed roast's stored Artisan file. Nothing is
 * saved and the roast is unchanged; Parchment's preview is returned unchanged.
 */
export async function previewReferenceProfileFromRoast(
  roastId: number,
  body: ReferenceProfileGenerationRequest,
  roastRevision?: string
) {
  const id = roastIdSchema.parse(roastId);
  const request = parseReferenceProfileGenerationRequest(body);
  const client = await createParchmentClient('member');
  const revision = await resolveRoastRevision(
    client,
    id,
    roastRevision,
    'reference-profile preview-from-roast'
  );
  return unwrapParchment(
    await client.referenceProfiles.previewFromRoast({
      ...request,
      roastId: id,
      roastRevision: revision,
    }),
    'reference-profile preview-from-roast'
  );
}

export interface SaveRoastAsReferenceInput {
  roastId: number;
  roastRevision?: string;
  /** Keep the roast's Artisan file so a plan can be built from the reference. */
  artisanSource?: boolean;
  title?: string;
  notes?: string;
}

/**
 * Save an executed roast as a reference profile. The roast is only read. Without
 * `artisanSource` the reference is Parchment's default, a comparison-only chart.
 */
export async function saveRoastAsReferenceProfile(
  input: SaveRoastAsReferenceInput,
  idempotencyKey?: string
) {
  const id = roastIdSchema.parse(input.roastId);
  const details = roastReferenceDetailsSchema.parse({
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
  const key = resolveReferenceProfileIdempotencyKey(idempotencyKey);
  const client = await createParchmentClient('member');
  const revision = await resolveRoastRevision(
    client,
    id,
    input.roastRevision,
    'reference-profile from-roast'
  );
  const body: ReferenceProfileFromRoastRequest = {
    roastId: id,
    roastRevision: revision,
    basis: input.artisanSource ? 'artisan_source' : 'chart_snapshot',
    ...details,
  };
  return unwrapParchment(
    await client.referenceProfiles.fromRoast(body, key),
    'reference-profile from-roast'
  );
}

/**
 * One side of a profile comparison. `revision:` and `roast:<id>@<revision>` are
 * exact immutable inputs. `profile:` and a bare `roast:<id>` are resolved to the
 * current immutable revision through Parchment before comparing.
 */
export type ProfileComparisonSelector =
  | { kind: 'revision'; revisionId: string }
  | { kind: 'profile'; profileId: string }
  | { kind: 'roast'; roastId: number; roastRevision?: string };

const ROAST_SELECTOR_PATTERN = /^roast:([1-9]\d{0,9})(?:@(.+))?$/;

/** Parse `revision:<uuid>`, `profile:<uuid>`, `roast:<id>`, or `roast:<id>@<revision>`. */
export function parseProfileComparisonSelector(
  value: string,
  label: string
): ProfileComparisonSelector {
  const trimmed = value.trim();
  const usage = `Invalid ${label} selector: "${value}". Use revision:<reference-revision-uuid>, profile:<reference-profile-uuid>, roast:<roast-id>, or roast:<roast-id>@<chart-revision>.`;

  if (trimmed.startsWith('revision:')) {
    const parsed = referenceProfileUuidSchema.safeParse(trimmed.slice('revision:'.length));
    if (!parsed.success) throw new PrvrsError('INVALID_ARGUMENT', usage);
    return { kind: 'revision', revisionId: parsed.data };
  }

  if (trimmed.startsWith('profile:')) {
    const parsed = referenceProfileUuidSchema.safeParse(trimmed.slice('profile:'.length));
    if (!parsed.success) throw new PrvrsError('INVALID_ARGUMENT', usage);
    return { kind: 'profile', profileId: parsed.data };
  }

  const roast = ROAST_SELECTOR_PATTERN.exec(trimmed);
  if (roast) {
    const roastId = Number(roast[1]);
    if (!Number.isSafeInteger(roastId) || roastId > POSTGRES_INT4_MAX) {
      throw new PrvrsError('INVALID_ARGUMENT', usage);
    }
    const roastRevision = roast[2]?.trim();
    if (roast[2] !== undefined && !roastRevision) {
      throw new PrvrsError('INVALID_ARGUMENT', usage);
    }
    return roastRevision ? { kind: 'roast', roastId, roastRevision } : { kind: 'roast', roastId };
  }

  throw new PrvrsError('INVALID_ARGUMENT', usage);
}

async function resolveProfileComparisonInput(
  client: ParchmentClient,
  selector: ProfileComparisonSelector
): Promise<ProfileComparisonInput> {
  if (selector.kind === 'revision') {
    return { type: 'reference_revision', revisionId: selector.revisionId };
  }

  if (selector.kind === 'profile') {
    const profile = unwrapParchment(
      await client.referenceProfiles.get(selector.profileId),
      'reference-profile compare'
    );
    return { type: 'reference_revision', revisionId: profile.data.currentRevisionId };
  }

  if (selector.roastRevision) {
    return {
      type: 'executed_roast',
      roastId: selector.roastId,
      roastRevision: selector.roastRevision,
    };
  }

  const chart = unwrapParchment(
    await client.roasts.chartData(String(selector.roastId)),
    `Roast ${selector.roastId} chart data`
  );
  const roastRevision = chart.data.metadata.revision;
  if (!roastRevision) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Roast ${selector.roastId} does not have an immutable chart revision and cannot be compared yet.`
    );
  }
  return { type: 'executed_roast', roastId: selector.roastId, roastRevision };
}

export interface CompareProfilesInput {
  left: ProfileComparisonSelector;
  right: ProfileComparisonSelector;
  targetUnit: ProfileComparisonUnit;
  targetPoints?: number;
}

/**
 * Compare two immutable revisions with Parchment's charge-aligned measured deltas.
 * The canonical comparison envelope is returned unchanged.
 */
export async function compareProfiles(
  input: CompareProfilesInput
): Promise<ProfileComparisonResponse> {
  const targetPoints = input.targetPoints ?? PROFILE_COMPARISON_TARGET_POINTS.default;
  if (
    !Number.isInteger(targetPoints) ||
    targetPoints < PROFILE_COMPARISON_TARGET_POINTS.minimum ||
    targetPoints > PROFILE_COMPARISON_TARGET_POINTS.maximum
  ) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid target points: ${targetPoints}. Must be an integer between ${PROFILE_COMPARISON_TARGET_POINTS.minimum} and ${PROFILE_COMPARISON_TARGET_POINTS.maximum}.`
    );
  }
  if (!profileComparisonUnits.includes(input.targetUnit)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid unit: "${input.targetUnit}". Must be one of: ${profileComparisonUnits.join(', ')}.`
    );
  }

  const client = await createParchmentClient('member');
  const [left, right] = await Promise.all([
    resolveProfileComparisonInput(client, input.left),
    resolveProfileComparisonInput(client, input.right),
  ]);
  return unwrapParchment(
    await client.referenceProfiles.compare({
      left,
      right,
      alignment: 'charge',
      targetUnit: input.targetUnit,
      targetPoints,
    }),
    'reference-profile compare'
  );
}
