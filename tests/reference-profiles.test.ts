import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});

import { createParchmentClient } from '../src/lib/parchment.js';
import {
  exportGeneratedReferenceProfile,
  getReferenceProfile,
  getReferenceProfileChart,
  importReferenceProfile,
  listReferenceProfiles,
  parseReferenceProfileImportRequest,
  parseReferenceProfileGenerationRequest,
  parseReferenceProfileId,
  previewReferenceProfile,
  resolveReferenceProfileIdempotencyKey,
  saveGeneratedReferenceProfile,
  writeGeneratedReferenceFile,
} from '../src/lib/reference-profiles.js';

const ok = <T>(data: T) => ({ data, response: new Response(null, { status: 200 }) });

const profileId = 'c01e221b-1b89-4ac4-b10c-0614c5b4fa03';
const revisionId = '7fbd8510-ff72-4585-93dc-b36d1ac53362';
const generatedRevisionId = '918a3633-5b36-4f1c-a8d6-cb7792a28565';

const request = {
  title: 'Later development',
  notes: 'Small next-batch adjustment',
  changes: {
    temperatureAdjustments: [
      {
        kind: 'bean_temperature' as const,
        startMilliseconds: 300_000,
        endMilliseconds: 420_000,
        delta: 3,
      },
    ],
  },
};

describe('reference profile SDK data plane', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates UUIDs and bounded, ordered temperature adjustments locally', () => {
    expect(parseReferenceProfileId(profileId, 'profile id')).toBe(profileId);
    expect(() => parseReferenceProfileId('not-a-uuid', 'profile id')).toThrow(
      'Invalid profile id: expected a UUID.'
    );
    expect(parseReferenceProfileGenerationRequest(request)).toEqual(request);
    expect(
      parseReferenceProfileGenerationRequest({
        ...request,
        changes: {
          temperatureAdjustments: [
            { ...request.changes.temperatureAdjustments[0], startMilliseconds: 300_000.5 },
          ],
        },
      }).changes.temperatureAdjustments[0].startMilliseconds
    ).toBe(300_000.5);
    expect(() =>
      parseReferenceProfileGenerationRequest({
        ...request,
        changes: {
          temperatureAdjustments: [
            { ...request.changes.temperatureAdjustments[0], endMilliseconds: 300_000 },
          ],
        },
      })
    ).toThrow('must be later than startMilliseconds');
    expect(() =>
      parseReferenceProfileGenerationRequest({
        ...request,
        changes: {
          temperatureAdjustments: [{ ...request.changes.temperatureAdjustments[0], delta: 0 }],
        },
      })
    ).toThrow();
    expect(() =>
      parseReferenceProfileGenerationRequest({
        ...request,
        changes: { temperatureAdjustments: [] },
      })
    ).toThrow();
    expect(resolveReferenceProfileIdempotencyKey('stable-write-key')).toBe('stable-write-key');
    expect(() => resolveReferenceProfileIdempotencyKey('k'.repeat(256))).toThrow();
    expect(() =>
      parseReferenceProfileImportRequest({
        fileName: 'baseline.alog',
        fileContent: '',
        fileSize: 0,
      })
    ).toThrow();
  });

  it('maps list, get, and chart reads to owner-scoped SDK methods', async () => {
    const profile = { id: profileId, currentRevisionId: revisionId };
    const list = vi.fn().mockResolvedValue(ok({ data: [profile] }));
    const get = vi.fn().mockResolvedValue(ok({ data: profile }));
    const chart = vi.fn().mockResolvedValue(ok({ data: { chart: { series: [], events: [] } } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      referenceProfiles: { list, get, chart },
    } as never);

    await expect(listReferenceProfiles(true)).resolves.toEqual({ data: [profile] });
    await expect(getReferenceProfile(profileId)).resolves.toEqual({ data: profile });
    await expect(getReferenceProfileChart(profileId, revisionId)).resolves.toMatchObject({
      data: { chart: { series: [], events: [] } },
    });

    expect(createParchmentClient).toHaveBeenCalledTimes(3);
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(list).toHaveBeenCalledWith(true);
    expect(get).toHaveBeenCalledWith(profileId);
    expect(chart).toHaveBeenCalledWith(profileId, revisionId);
  });

  it('uploads the source with a stable idempotency key through the SDK', async () => {
    const sdkImport = vi.fn().mockResolvedValue(ok({ data: { id: profileId } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      referenceProfiles: { import: sdkImport },
    } as never);
    const body = {
      fileName: 'baseline.alog',
      fileContent: 'timeindex = [0, 1]',
      fileSize: 19,
      title: 'Baseline',
    };

    await expect(importReferenceProfile(body, 'stable-import-key')).resolves.toEqual({
      data: { id: profileId },
    });
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(sdkImport).toHaveBeenCalledWith(body, 'stable-import-key');
  });

  it('uses the same typed change set for preview and idempotent save', async () => {
    const preview = vi.fn().mockResolvedValue(ok({ data: { parentRevisionId: revisionId } }));
    const generate = vi.fn().mockResolvedValue(ok({ data: { id: profileId } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      referenceProfiles: { preview, generate },
    } as never);

    await expect(previewReferenceProfile(profileId, revisionId, request)).resolves.toEqual({
      data: { parentRevisionId: revisionId },
    });
    await expect(
      saveGeneratedReferenceProfile(profileId, revisionId, request, 'stable-save-key')
    ).resolves.toEqual({ data: { id: profileId } });

    expect(preview).toHaveBeenCalledWith(profileId, revisionId, request);
    expect(generate).toHaveBeenCalledWith(profileId, revisionId, request, 'stable-save-key');
  });

  it('retrieves exports only for the requested saved generated revision', async () => {
    const exportGenerated = vi.fn().mockResolvedValue(
      ok({
        data: {
          fileName: 'Purveyors-reference.alog',
          fileContent: 'title = "Purveyors plan"',
          fileSize: 25,
        },
      })
    );
    vi.mocked(createParchmentClient).mockResolvedValue({
      referenceProfiles: { exportGenerated },
    } as never);

    await expect(
      exportGeneratedReferenceProfile(profileId, generatedRevisionId)
    ).resolves.toMatchObject({ data: { fileName: 'Purveyors-reference.alog', fileSize: 25 } });
    expect(exportGenerated).toHaveBeenCalledWith(profileId, generatedRevisionId);
  });

  it('writes exported plans without overwriting a local file unless requested', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purvey-reference-profile-'));
    const destination = join(directory, 'next-batch.alog');
    try {
      await expect(writeGeneratedReferenceFile('first plan', destination)).resolves.toBe(
        resolve(destination)
      );
      await expect(readFile(destination, 'utf8')).resolves.toBe('first plan');

      await expect(
        writeGeneratedReferenceFile('replacement plan', destination)
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(readFile(destination, 'utf8')).resolves.toBe('first plan');

      await expect(
        writeGeneratedReferenceFile('replacement plan', destination, true)
      ).resolves.toBe(resolve(destination));
      await expect(readFile(destination, 'utf8')).resolves.toBe('replacement plan');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
