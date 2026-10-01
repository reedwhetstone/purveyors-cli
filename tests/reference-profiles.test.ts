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
  compareProfiles,
  exportGeneratedReferenceProfile,
  getReferenceProfile,
  getReferenceProfileChart,
  importReferenceProfile,
  listReferenceProfiles,
  parseReferenceProfileImportRequest,
  parseReferenceProfileGenerationRequest,
  parseProfileComparisonSelector,
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

describe('reference profile provenance and comparison', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts the bounded provenance fields the web agent sends with a generation request', () => {
    const withProvenance = {
      ...request,
      userGoal: 'Stretch development without scorching',
      modelRecommendation: 'Raise BT 3 degrees between 5:00 and 7:00',
      userEdits: 'Start the change 30 seconds later',
    };
    expect(parseReferenceProfileGenerationRequest(withProvenance)).toEqual(withProvenance);
    expect(() =>
      parseReferenceProfileGenerationRequest({ ...request, userGoal: 'x'.repeat(601) })
    ).toThrow();
    expect(() =>
      parseReferenceProfileGenerationRequest({ ...request, modelRecommendation: '' })
    ).toThrow();
  });

  it('parses revision, profile, and roast comparison selectors', () => {
    expect(parseProfileComparisonSelector(`revision:${revisionId}`, 'left')).toEqual({
      kind: 'revision',
      revisionId,
    });
    expect(parseProfileComparisonSelector(`profile:${profileId}`, 'left')).toEqual({
      kind: 'profile',
      profileId,
    });
    expect(parseProfileComparisonSelector('roast:42', 'right')).toEqual({
      kind: 'roast',
      roastId: 42,
    });
    expect(parseProfileComparisonSelector('roast:42@rev-a1', 'right')).toEqual({
      kind: 'roast',
      roastId: 42,
      roastRevision: 'rev-a1',
    });
    for (const invalid of ['42', 'roast:0', 'roast:42@', 'revision:nope', 'profile:', 'roast:x']) {
      expect(() => parseProfileComparisonSelector(invalid, 'left')).toThrow(
        'Invalid left selector'
      );
    }
  });

  it('resolves current revisions and returns the canonical comparison envelope', async () => {
    const envelope = { data: { alignment: 'charge', targetUnit: 'C' }, meta: {} };
    const client = {
      referenceProfiles: {
        get: vi.fn().mockResolvedValue(ok({ data: { currentRevisionId: revisionId } })),
        compare: vi.fn().mockResolvedValue(ok(envelope)),
      },
      roasts: {
        chartData: vi.fn().mockResolvedValue(ok({ data: { metadata: { revision: 'rev-42' } } })),
      },
    };
    vi.mocked(createParchmentClient).mockResolvedValue(client as never);

    await expect(
      compareProfiles({
        left: { kind: 'roast', roastId: 42 },
        right: { kind: 'profile', profileId },
        targetUnit: 'C',
      })
    ).resolves.toEqual(envelope);

    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(client.roasts.chartData).toHaveBeenCalledWith('42');
    expect(client.referenceProfiles.get).toHaveBeenCalledWith(profileId);
    expect(client.referenceProfiles.compare).toHaveBeenCalledWith({
      left: { type: 'executed_roast', roastId: 42, roastRevision: 'rev-42' },
      right: { type: 'reference_revision', revisionId },
      alignment: 'charge',
      targetUnit: 'C',
      targetPoints: 400,
    });
  });

  it('uses exact revisions without extra reads and rejects roasts without a chart revision', async () => {
    const client = {
      referenceProfiles: {
        get: vi.fn(),
        compare: vi.fn().mockResolvedValue(ok({ data: {}, meta: {} })),
      },
      roasts: {
        chartData: vi.fn().mockResolvedValue(ok({ data: { metadata: { revision: null } } })),
      },
    };
    vi.mocked(createParchmentClient).mockResolvedValue(client as never);

    await compareProfiles({
      left: { kind: 'revision', revisionId },
      right: { kind: 'roast', roastId: 7, roastRevision: 'rev-7' },
      targetUnit: 'F',
      targetPoints: 120,
    });
    expect(client.referenceProfiles.get).not.toHaveBeenCalled();
    expect(client.roasts.chartData).not.toHaveBeenCalled();
    expect(client.referenceProfiles.compare).toHaveBeenCalledWith(
      expect.objectContaining({
        right: { type: 'executed_roast', roastId: 7, roastRevision: 'rev-7' },
        targetPoints: 120,
      })
    );

    await expect(
      compareProfiles({
        left: { kind: 'roast', roastId: 9 },
        right: { kind: 'revision', revisionId },
        targetUnit: 'F',
      })
    ).rejects.toThrow('Roast 9 does not have an immutable chart revision');
    await expect(
      compareProfiles({
        left: { kind: 'revision', revisionId },
        right: { kind: 'revision', revisionId },
        targetUnit: 'F',
        targetPoints: 49,
      })
    ).rejects.toThrow('Invalid target points: 49');
  });
});
