import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { components } from '@purveyors/sdk';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { normalizePathInput } from './path-input.js';

export type ReferenceProfileImportRequest = components['schemas']['ReferenceProfileImportRequest'];
export type ReferenceProfileGenerationRequest =
  components['schemas']['ReferenceProfileGenerationRequest'];

export const REFERENCE_PROFILE_SOURCE_MAX_BYTES = 10_000_000;

const referenceProfileUuidSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(1).max(255);

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
