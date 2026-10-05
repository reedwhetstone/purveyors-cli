import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import type { FSWatcher } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  startWatch,
  type StartWatchRuntime,
  type WatchBatchRecord,
  type WatchBatchStore,
} from '../src/lib/interactive/watch.js';

const { pickBeanMock, guardCancelMock, classifyRoastMock } = vi.hoisted(() => ({
  pickBeanMock: vi.fn(),
  guardCancelMock: vi.fn(),
  classifyRoastMock: vi.fn(),
}));

vi.mock('../src/lib/interactive/forms.js', () => ({
  pickBean: pickBeanMock,
  guardCancel: guardCancelMock,
}));

vi.mock('../src/lib/cherry.js', () => ({
  classifyRoast: classifyRoastMock,
}));

let stderrSpy: ReturnType<typeof vi.spyOn>;
let stderrOutput: string[];

function createImportResult(roastId: number) {
  return {
    roast_id: roastId,
    batch_name: `Batch #${roastId}`,
    coffee_name: 'Test Coffee',
    coffee_id: 7,
    message: '12 data points imported',
    milestones: { charge: 30, drop: 540 },
    phases: {
      drying_percent: 40,
      maillard_percent: 35,
      development_percent: 25,
      total_time_seconds: 540,
    },
    milestone_events: 2,
    control_events: 0,
  };
}

const SESSION_BATCH_ID = '7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e';

/**
 * In-memory stand-in for the batch API. `create` always opens a new batch, as
 * the API does, and `attach` records a roast saved into one.
 */
function createFakeBatchStore() {
  const batches = new Map<string, WatchBatchRecord>();
  const roastBatch = new Map<number, string>();
  let opened = 0;

  const store = {
    create: vi.fn(async ({ name, batchDate }: { name: string; batchDate: string }) => {
      const id = opened === 0 ? SESSION_BATCH_ID : `00000000-0000-4000-8000-00000000000${opened}`;
      opened += 1;
      const batch: WatchBatchRecord = { id, name, batchDate, roastIds: [] };
      batches.set(id, batch);
      return batch;
    }),
    get: vi.fn(async (batchId: string) => batches.get(batchId) ?? null),
    delete: vi.fn(async (batchId: string) => {
      batches.delete(batchId);
    }),
    batchIdForRoast: vi.fn(async (roastId: number) => roastBatch.get(roastId) ?? null),
  } satisfies WatchBatchStore;

  return {
    store,
    batches,
    /** Add a batch that already exists on the account, with the roasts in it. */
    seed(batch: WatchBatchRecord) {
      batches.set(batch.id, batch);
      for (const roastId of batch.roastIds) roastBatch.set(roastId, batch.id);
    },
    attach(batchId: string, roastId: number) {
      batches.get(batchId)?.roastIds.push(roastId);
      roastBatch.set(roastId, batchId);
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createRuntime() {
  let callback: ((eventType: string, filename: string) => void) | null = null;
  const close = vi.fn();
  const saveWatchSessionImpl = vi.fn().mockResolvedValue(undefined);
  const roastImporter = vi.fn();
  const batches = createFakeBatchStore();
  const signalListeners = new Map<'SIGINT' | 'SIGTERM', () => void>();
  let exitKeyListener: (() => void) | null = null;
  const cleanupExitKeyListener = vi.fn(() => {
    exitKeyListener = null;
  });

  const runtime: StartWatchRuntime = {
    debounceMs: 1,
    saveWatchSessionImpl,
    roastImporter,
    batchStore: batches.store,
    sessionTokenProvider: vi.fn().mockResolvedValue('session-token'),
    inventoryLister: vi.fn().mockResolvedValue([
      {
        id: 88,
        coffee_catalog: { name: 'Matched Bean', country: 'Ethiopia', processing: 'Washed' },
      },
    ]),
    addSignalListener: vi.fn((signal, listener) => {
      signalListeners.set(signal, listener);
    }),
    removeSignalListener: vi.fn((signal) => {
      signalListeners.delete(signal);
    }),
    addExitKeyListener: vi.fn((listener) => {
      exitKeyListener = listener;
      return cleanupExitKeyListener;
    }),
    watchImpl: vi.fn((_directory, _options, registeredCallback) => {
      callback = registeredCallback as (eventType: string, filename: string) => void;
      return { close } as unknown as FSWatcher;
    }),
  };

  return {
    runtime,
    close,
    saveWatchSessionImpl,
    roastImporter,
    batches,
    emitFileEvent(filename: string) {
      if (!callback) {
        throw new Error('watch callback was not registered');
      }
      callback('rename', filename);
    },
    emitSignal(signal: 'SIGINT' | 'SIGTERM') {
      const listener = signalListeners.get(signal);
      if (!listener) {
        throw new Error(`signal listener not registered for ${signal}`);
      }
      listener();
    },
    emitExitKey() {
      if (!exitKeyListener) {
        throw new Error('exit key listener not registered');
      }
      exitKeyListener();
    },
    hasSignalListener(signal: 'SIGINT' | 'SIGTERM') {
      return signalListeners.has(signal);
    },
    hasExitKeyListener() {
      return exitKeyListener !== null;
    },
    cleanupExitKeyListener,
  };
}

function createAutoMatchCredentialContext(matchId: number, coffeeName: string) {
  const limit = vi.fn().mockResolvedValue({
    data: [
      {
        id: matchId,
        coffee_catalog: {
          name: coffeeName,
          country: 'Ethiopia',
          processing: 'Washed',
        },
      },
    ],
    error: null,
  });
  const eqStocked = vi.fn(() => ({ limit }));
  const eqUser = vi.fn(() => ({ eq: eqStocked }));
  const select = vi.fn(() => ({ eq: eqUser }));

  return {
    from: vi.fn(() => ({ select })),
  } as never;
}

beforeEach(() => {
  pickBeanMock.mockReset();
  pickBeanMock.mockResolvedValue({ id: 41, name: 'Prompt Picked Bean' });
  guardCancelMock.mockReset();
  guardCancelMock.mockImplementation(() => undefined);
  classifyRoastMock.mockReset();

  stderrOutput = [];
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrOutput.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  stderrSpy.mockRestore();
  await flushPromises();
});

describe('startWatch', () => {
  it('queues batch imports and commits them on shutdown with metadata preserved', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(101));

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Ethiopia Guji',
        batchPrefix: 'Ethiopia Guji',
        commitMode: 'batch',
        ozIn: 16,
        roastNotes: 'Sweet and floral',
        roastTargets: 'Aim for 18% development',
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'new-roast.alog'), 'alog content');
    runtime.emitFileEvent('new-roast.alog');
    await sleep(10);

    expect(runtime.roastImporter).not.toHaveBeenCalled();

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileContent: 'alog content',
        fileName: 'new-roast.alog',
        coffeeId: 7,
        batchName: 'Ethiopia Guji',
        ozIn: 16,
        roastNotes: 'Sweet and floral',
        roastTargets: 'Aim for 18% development',
      })
    );
    expect(session.imports).toHaveLength(1);
    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        fileName: 'new-roast.alog',
        status: 'success',
        roastId: 101,
        selectedCoffeeId: 7,
        selectedCoffeeName: 'Ethiopia Guji',
      })
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('treats Ctrl+C key bytes as shutdown when the terminal is in raw mode', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-exit-key-'));
    const { runtime, emitFileEvent, emitExitKey, hasExitKeyListener, cleanupExitKeyListener } =
      createRuntime();

    pickBeanMock.mockResolvedValue({ id: 7, name: 'Test Coffee' });
    runtime.roastImporter?.mockResolvedValue(createImportResult(456));

    const promise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Test Coffee',
        batchPrefix: 'Exit Key',
        commitMode: 'batch',
      },
      runtime
    );

    await sleep(10);
    expect(hasExitKeyListener()).toBe(true);

    await writeFile(join(watchDir, 'exit-key.alog'), 'exit key content');
    emitFileEvent('exit-key.alog');
    await sleep(5);
    await flushPromises();

    emitExitKey();
    const session = await promise;

    expect(session.imports[0]?.status).toBe('success');
    expect(runtime.roastImporter).toHaveBeenCalledOnce();
    expect(cleanupExitKeyListener).toHaveBeenCalledOnce();
    expect(hasExitKeyListener()).toBe(false);
  });

  it('rehydrates pending resume imports and finalizes them on shutdown', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(202));
    await writeFile(join(watchDir, 'resume.alog'), 'resume content');

    const sessionPromise = startWatch(
      {} as never,
      'user-2',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'batch',
        roastTargets: 'Land at City+',
        resumeImports: [
          {
            fileName: 'resume.alog',
            roastId: null,
            batchName: 'Recovered Batch #2',
            status: 'pending',
            importedAt: '2026-04-12T00:00:00.000Z',
            selectedCoffeeId: 22,
            selectedCoffeeName: 'Recovered Bean',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    runtime.emitSignal('SIGTERM');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileContent: 'resume content',
        fileName: 'resume.alog',
        coffeeId: 22,
        batchName: 'Recovered Batch #2',
        roastTargets: 'Land at City+',
      })
    );
    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        status: 'success',
        roastId: 202,
        selectedCoffeeId: 22,
        selectedCoffeeName: 'Recovered Bean',
      })
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('saves every roast from a batch-mode session under one shared batch name', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-one-session-'));
    const runtime = createRuntime();
    runtime.roastImporter
      .mockResolvedValueOnce(createImportResult(301))
      .mockResolvedValueOnce(createImportResult(302))
      .mockResolvedValueOnce(createImportResult(303));

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      { coffeeId: 7, coffeeName: 'Ethiopia Guji', batchPrefix: 'wednesday', commitMode: 'batch' },
      runtime.runtime
    );

    await sleep(10);
    for (const fileName of ['first.alog', 'second.alog', 'third.alog']) {
      await writeFile(join(watchDir, fileName), `${fileName} content`);
      runtime.emitFileEvent(fileName);
      await sleep(10);
    }

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(
      runtime.roastImporter.mock.calls.map(([args]) => [args.fileName, args.batchName])
    ).toEqual([
      ['first.alog', 'wednesday'],
      ['second.alog', 'wednesday'],
      ['third.alog', 'wednesday'],
    ]);
    // Each roast stays identifiable in the session state and the summary table.
    expect(
      session.imports.map((record) => [
        record.sequence,
        record.fileName,
        record.roastId,
        record.batchName,
      ])
    ).toEqual([
      [1, 'first.alog', 301, 'wednesday'],
      [2, 'second.alog', 302, 'wednesday'],
      [3, 'third.alog', 303, 'wednesday'],
    ]);
    expect(runtime.saveWatchSessionImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        batchPrefix: 'wednesday',
        commitMode: 'batch',
        imports: [
          expect.objectContaining({ sequence: 1, batchName: 'wednesday', roastId: 301 }),
          expect.objectContaining({ sequence: 2, batchName: 'wednesday', roastId: 302 }),
          expect.objectContaining({ sequence: 3, batchName: 'wednesday', roastId: 303 }),
        ],
      })
    );

    const output = stderrOutput.join('');
    expect(output).toContain('batch commit mode, batch: "wednesday"');
    expect(output).toContain('… Queued: second.alog → wednesday (roast 2)');
    expect(output).not.toContain('wednesday #');

    await rm(watchDir, { recursive: true, force: true });
  });

  it('keeps a distinct numbered batch name per roast in individual mode', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-individual-names-'));
    const runtime = createRuntime();
    runtime.roastImporter
      .mockResolvedValueOnce(createImportResult(401))
      .mockResolvedValueOnce(createImportResult(402))
      .mockResolvedValueOnce(createImportResult(403));

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Ethiopia Guji',
        batchPrefix: 'wednesday',
        commitMode: 'individual',
      },
      runtime.runtime
    );

    await sleep(10);
    for (const fileName of ['first.alog', 'second.alog', 'third.alog']) {
      await writeFile(join(watchDir, fileName), `${fileName} content`);
      runtime.emitFileEvent(fileName);
      await sleep(10);
    }

    // Individual mode saves each roast as its file appears, before shutdown.
    expect(runtime.roastImporter).toHaveBeenCalledTimes(3);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter.mock.calls.map(([args]) => args.batchName)).toEqual([
      'wednesday #1',
      'wednesday #2',
      'wednesday #3',
    ]);
    expect(session.imports.map((record) => [record.sequence, record.batchName])).toEqual([
      [1, 'wednesday #1'],
      [2, 'wednesday #2'],
      [3, 'wednesday #3'],
    ]);
    expect(stderrOutput.join('')).toContain(
      'individual commit mode, batch names: "wednesday #1", "wednesday #2", …'
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('keeps adding to the same batch when a batch-mode session is resumed', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-session-'));
    const runtime = createRuntime();
    runtime.roastImporter
      .mockResolvedValueOnce(createImportResult(502))
      .mockResolvedValueOnce(createImportResult(503));
    await writeFile(join(watchDir, 'queued.alog'), 'queued content');

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Ethiopia Guji',
        batchPrefix: 'wednesday',
        commitMode: 'batch',
        resumeImports: [
          {
            fileName: 'done.alog',
            roastId: 501,
            batchName: 'wednesday',
            sequence: 1,
            status: 'success',
            importedAt: '2026-09-29T00:00:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
          {
            fileName: 'queued.alog',
            roastId: null,
            batchName: 'wednesday',
            sequence: 2,
            status: 'pending',
            importedAt: '2026-09-29T00:10:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'next.alog'), 'next content');
    runtime.emitFileEvent('next.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(
      runtime.roastImporter.mock.calls.map(([args]) => [args.fileName, args.batchName])
    ).toEqual([
      ['queued.alog', 'wednesday'],
      ['next.alog', 'wednesday'],
    ]);
    expect(
      session.imports.map((record) => [record.sequence, record.fileName, record.batchName])
    ).toEqual([
      [1, 'done.alog', 'wednesday'],
      [2, 'queued.alog', 'wednesday'],
      [3, 'next.alog', 'wednesday'],
    ]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('moves unsaved roasts into the shared batch when resuming a session saved with numbered names', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-numbered-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(602));
    await writeFile(join(watchDir, 'queued.alog'), 'queued content');

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Ethiopia Guji',
        batchPrefix: 'wednesday',
        commitMode: 'batch',
        resumeImports: [
          {
            fileName: 'done.alog',
            roastId: 601,
            batchName: 'wednesday #1',
            status: 'success',
            importedAt: '2026-09-29T00:00:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
          {
            fileName: 'queued.alog',
            roastId: null,
            batchName: 'wednesday #2',
            status: 'pending',
            importedAt: '2026-09-29T00:10:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'queued.alog', batchName: 'wednesday' })
    );
    // The roast that was already saved keeps the name it was saved under.
    expect(
      session.imports.map((record) => [record.sequence, record.fileName, record.batchName])
    ).toEqual([
      [1, 'done.alog', 'wednesday #1'],
      [2, 'queued.alog', 'wednesday'],
    ]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('continues sequential batch numbering for new files after resume', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-seq-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(606));

    const sessionPromise = startWatch(
      {} as never,
      'user-7',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'individual',
        resumeImports: [
          {
            fileName: 'done.alog',
            roastId: 99,
            batchName: 'Original Bean #1',
            status: 'success',
            importedAt: '2026-04-12T00:00:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Original Bean',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'next.alog'), 'next content');
    runtime.emitFileEvent('next.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'next.alog',
        batchName: 'Original Bean #2',
      })
    );
    expect(session.imports).toHaveLength(2);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('continues after the highest saved position when a resumed session has a gap', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-gap-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(608));

    // Two files were detected together; the second finished and was saved, and
    // the process ended before the first was persisted.
    const sessionPromise = startWatch(
      {} as never,
      'user-7',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'individual',
        resumeImports: [
          {
            fileName: 'second.alog',
            roastId: 99,
            batchName: 'Original Bean #2',
            sequence: 2,
            status: 'success',
            importedAt: '2026-04-12T00:00:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Original Bean',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'next.alog'), 'next content');
    runtime.emitFileEvent('next.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'next.alog', batchName: 'Original Bean #3' })
    );
    expect(
      session.imports.map((record) => [record.sequence, record.fileName, record.batchName])
    ).toEqual([
      [2, 'second.alog', 'Original Bean #2'],
      [3, 'next.alog', 'Original Bean #3'],
    ]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('does not reuse a numbered name from a session saved without positions', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-legacy-gap-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(609));

    const sessionPromise = startWatch(
      {} as never,
      'user-7',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'individual',
        resumeImports: [
          {
            fileName: 'second.alog',
            roastId: 99,
            batchName: 'Original Bean #2',
            status: 'success',
            importedAt: '2026-04-12T00:00:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Original Bean',
          },
        ],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'next.alog'), 'next content');
    runtime.emitFileEvent('next.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'next.alog', batchName: 'Original Bean #3' })
    );
    expect(session.imports.map((record) => [record.sequence, record.batchName])).toEqual([
      [2, 'Original Bean #2'],
      [3, 'Original Bean #3'],
    ]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('skips a file and keeps the session alive when bean selection is cancelled', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-cancel-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(707));
    pickBeanMock.mockReset();
    pickBeanMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9, name: 'Picked Bean' });

    const sessionPromise = startWatch(
      {} as never,
      'user-8',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'batch',
        promptEach: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'cancelled.alog'), 'cancelled content');
    runtime.emitFileEvent('cancelled.alog');
    await sleep(10);

    await writeFile(join(watchDir, 'picked.alog'), 'picked content');
    runtime.emitFileEvent('picked.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(pickBeanMock).toHaveBeenCalledWith('session-token', { allowCancel: true });
    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        fileName: 'cancelled.alog',
        status: 'needs-review',
        error: 'Bean selection cancelled',
      })
    );
    expect(session.imports[1]).toEqual(
      expect.objectContaining({
        fileName: 'picked.alog',
        status: 'success',
        selectedCoffeeId: 9,
      })
    );
    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'picked.alog', coffeeId: 9 })
    );
    const combined = stderrOutput.join('');
    expect(combined).toContain('Skipped cancelled.alog');
    expect(combined).toContain('manual bean assignment');

    await rm(watchDir, { recursive: true, force: true });
  });

  it('records picker failures and allows the same file to be retried', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-picker-error-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(708));
    pickBeanMock
      .mockRejectedValueOnce(new Error('Inventory unavailable'))
      .mockResolvedValueOnce({ id: 10, name: 'Recovered Bean' });

    const sessionPromise = startWatch(
      {} as never,
      'user-9',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'batch',
        promptEach: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'retry.alog'), 'retry content');
    runtime.emitFileEvent('retry.alog');
    await sleep(10);

    runtime.emitFileEvent('retry.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        fileName: 'retry.alog',
        status: 'needs-review',
        error: 'Bean selection failed: Inventory unavailable',
      })
    );
    expect(session.imports[1]).toEqual(
      expect.objectContaining({
        fileName: 'retry.alog',
        status: 'success',
        selectedCoffeeId: 10,
      })
    );
    expect(pickBeanMock).toHaveBeenCalledTimes(2);
    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(stderrOutput.join('')).toContain(
      'Needs review: retry.alog — Bean selection failed: Inventory unavailable'
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('persists watch mode flags in the saved session state', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-prompt-each-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(240));
    pickBeanMock.mockResolvedValue({ id: 24, name: 'Prompt Resume Bean' });

    const sessionPromise = startWatch(
      {} as never,
      'user-4',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'batch',
        promptEach: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'prompt-each.alog'), 'prompt each content');
    runtime.emitFileEvent('prompt-each.alog');
    await sleep(10);

    expect(runtime.saveWatchSessionImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        promptEach: true,
        autoMatch: false,
        imports: [
          expect.objectContaining({
            fileName: 'prompt-each.alog',
            selectedCoffeeId: 24,
            selectedCoffeeName: 'Prompt Resume Bean',
          }),
        ],
      })
    );

    runtime.emitSignal('SIGINT');
    await sessionPromise;

    await rm(watchDir, { recursive: true, force: true });
  });

  it('restores auto-match behavior for new files after resume', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-auto-resume-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(404));
    classifyRoastMock.mockResolvedValue({
      match: {
        inventoryId: 88,
        coffeeName: 'Matched Bean',
        confidence: 94,
        reasoning: 'Filename and metadata match the stocked lot',
      },
    });

    const sessionPromise = startWatch(
      createAutoMatchCredentialContext(88, 'Matched Bean'),
      'user-5',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
        promptEach: false,
        startedAt: '2026-04-12T00:00:00.000Z',
        resumeImports: [],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'resumed-auto.alog'), 'auto match content');
    runtime.emitFileEvent('resumed-auto.alog');
    await sleep(10);

    expect(classifyRoastMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        artisanSource: {
          fileName: 'resumed-auto.alog',
          fileContent: 'auto match content',
        },
      })
    );
    expect(runtime.saveWatchSessionImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        autoMatch: true,
        promptEach: false,
        imports: [
          expect.objectContaining({
            fileName: 'resumed-auto.alog',
            selectedCoffeeId: 88,
            selectedCoffeeName: 'Matched Bean',
          }),
        ],
      })
    );

    runtime.emitSignal('SIGTERM');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'resumed-auto.alog',
        coffeeId: 88,
      })
    );
    expect(runtime.roastImporter).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'resumed-auto.alog',
        coffeeId: 0,
      })
    );
    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        selectedCoffeeId: 88,
        selectedCoffeeName: 'Matched Bean',
        status: 'success',
      })
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('matches a filename supplier when it identifies exactly one stocked coffee', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-supplier-match-'));
    const runtime = createRuntime();
    runtime.runtime.inventoryLister = vi.fn().mockResolvedValue([
      {
        id: 71,
        coffee_catalog: {
          name: 'Kenya Nyeri AA',
          source: 'Showroom Coffee',
          country: 'Kenya',
          processing: 'Washed',
        },
      },
      {
        id: 72,
        coffee_catalog: {
          name: 'Honduras Pineapple',
          source: 'Genuine Origin',
          country: 'Honduras',
          processing: 'Co-ferment',
        },
      },
    ]);
    runtime.roastImporter.mockResolvedValue(createImportResult(711));

    const sessionPromise = startWatch(
      {} as never,
      'user-supplier',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'showroom_kenya_20260722.alog'), 'supplier content');
    runtime.emitFileEvent('showroom_kenya_20260722.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(classifyRoastMock).not.toHaveBeenCalled();
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'showroom_kenya_20260722.alog',
        coffeeId: 71,
      })
    );
    expect(session.imports[0]).toMatchObject({
      status: 'success',
      selectedCoffeeId: 71,
      selectedCoffeeName: 'Kenya Nyeri AA',
      matchMethod: 'inventory',
      aiMatch: { confidence: 100 },
    });
    expect(stderrOutput.join('')).toContain('Inventory matched: showroom_kenya_20260722.alog');

    await rm(watchDir, { recursive: true, force: true });
  });

  it('checks later inventory pages before trusting supplier uniqueness', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-supplier-pagination-'));
    const runtime = createRuntime();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: 1000 + index,
      coffee_catalog: {
        name: index === 0 ? 'Kenya First Showroom' : `Bean ${index}`,
        source: index === 0 ? 'Showroom Coffee' : 'Other Coffee',
      },
    }));
    const secondPage = [
      {
        id: 1100,
        coffee_catalog: { name: 'Kenya Second Showroom', source: 'Showroom Coffee' },
      },
    ];
    const inventoryLister = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    runtime.runtime.inventoryLister = inventoryLister;
    classifyRoastMock.mockResolvedValue({ match: null });

    const sessionPromise = startWatch(
      {} as never,
      'user-supplier-pagination',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'showroom_kenya_20260722.alog'), 'supplier content');
    runtime.emitFileEvent('showroom_kenya_20260722.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(inventoryLister).toHaveBeenCalledTimes(2);
    expect(inventoryLister).toHaveBeenNthCalledWith(
      1,
      { stocked_only: true, limit: 100, offset: 0 },
      'session-token'
    );
    expect(inventoryLister).toHaveBeenNthCalledWith(
      2,
      { stocked_only: true, limit: 100, offset: 100 },
      'session-token'
    );
    expect(classifyRoastMock).toHaveBeenCalledOnce();
    expect(runtime.roastImporter).not.toHaveBeenCalled();
    expect(session.imports[0]).toMatchObject({
      status: 'needs-review',
      error: 'AI returned no match',
    });

    await rm(watchDir, { recursive: true, force: true });
  });

  it('falls back to AI when a filename supplier has multiple stocked coffees', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-supplier-ambiguous-'));
    const runtime = createRuntime();
    runtime.runtime.inventoryLister = vi.fn().mockResolvedValue([
      { id: 71, coffee_catalog: { name: 'Kenya AA', source: 'Showroom Coffee' } },
      { id: 73, coffee_catalog: { name: 'Kenya Peaberry', source: 'Showroom Coffee' } },
    ]);
    classifyRoastMock.mockResolvedValue({ match: null });

    const sessionPromise = startWatch(
      {} as never,
      'user-supplier',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'showroom_kenya.alog'), 'supplier content');
    runtime.emitFileEvent('showroom_kenya.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(classifyRoastMock).toHaveBeenCalledOnce();
    expect(session.imports[0]).toMatchObject({
      status: 'needs-review',
      error: 'AI returned no match',
    });

    await rm(watchDir, { recursive: true, force: true });
  });

  it('continues --form recovery with a stocked-inventory picker', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-form-recovery-'));
    const runtime = createRuntime();
    classifyRoastMock.mockResolvedValue({ match: null });
    pickBeanMock.mockResolvedValue({ id: 71, name: 'Kenya Nyeri AA' });
    runtime.roastImporter.mockResolvedValue(createImportResult(712));

    const sessionPromise = startWatch(
      {} as never,
      'user-form',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Newstart',
        commitMode: 'batch',
        autoMatch: true,
        interactiveRecovery: true,
        ozIn: 15,
        roastNotes: 'Early drop',
        roastTargets: 'Light',
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'unmatched.alog'), 'unmatched content');
    runtime.emitFileEvent('unmatched.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(pickBeanMock).toHaveBeenCalledWith('session-token', { allowCancel: true });
    expect(runtime.roastImporter).toHaveBeenCalledWith({
      batchId: SESSION_BATCH_ID,
      fileContent: 'unmatched content',
      fileName: 'unmatched.alog',
      coffeeId: 71,
      batchName: 'Newstart',
      ozIn: 15,
      roastNotes: 'Early drop',
      roastTargets: 'Light',
    });
    expect(session.imports[0]).toMatchObject({
      status: 'success',
      selectedCoffeeId: 71,
      selectedCoffeeName: 'Kenya Nyeri AA',
    });
    expect(stderrOutput.join('')).not.toContain('manual bean assignment');

    await rm(watchDir, { recursive: true, force: true });
  });

  it('keeps the manual fallback when --form recovery is cancelled', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-form-cancel-'));
    const runtime = createRuntime();
    classifyRoastMock.mockResolvedValue({ match: null });
    pickBeanMock.mockResolvedValue(null);

    const sessionPromise = startWatch(
      {} as never,
      'user-form',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
        interactiveRecovery: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'unmatched.alog'), 'unmatched content');
    runtime.emitFileEvent('unmatched.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).not.toHaveBeenCalled();
    expect(session.imports[0]?.status).toBe('needs-review');
    expect(stderrOutput.join('')).toContain('manual bean assignment');

    await rm(watchDir, { recursive: true, force: true });
  });

  it('restores prompt-each behavior for new files after resume', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-prompt-resume-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockResolvedValue(createImportResult(505));
    pickBeanMock.mockResolvedValue({ id: 55, name: 'Resumed Prompt Bean' });

    const sessionPromise = startWatch(
      {} as never,
      'user-6',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Original Bean',
        batchPrefix: 'Original Bean',
        commitMode: 'batch',
        promptEach: true,
        autoMatch: false,
        startedAt: '2026-04-12T00:00:00.000Z',
        resumeImports: [],
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'resumed-prompt.alog'), 'prompt resume content');
    runtime.emitFileEvent('resumed-prompt.alog');
    await sleep(10);

    expect(pickBeanMock).toHaveBeenCalledTimes(1);
    expect(runtime.saveWatchSessionImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        promptEach: true,
        autoMatch: false,
        imports: [
          expect.objectContaining({
            fileName: 'resumed-prompt.alog',
            selectedCoffeeId: 55,
            selectedCoffeeName: 'Resumed Prompt Bean',
          }),
        ],
      })
    );

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'resumed-prompt.alog',
        coffeeId: 55,
      })
    );
    expect(session.imports[0]).toEqual(
      expect.objectContaining({
        selectedCoffeeId: 55,
        selectedCoffeeName: 'Resumed Prompt Bean',
        status: 'success',
      })
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('keeps shutdown idempotent when a second signal arrives during batch finalization', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-shutdown-'));
    const runtime = createRuntime();
    let resolveImport: ((value: ReturnType<typeof createImportResult>) => void) | undefined;

    runtime.roastImporter.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        })
    );

    const sessionPromise = startWatch(
      {} as never,
      'user-3',
      watchDir,
      {
        coffeeId: 7,
        coffeeName: 'Shutdown Test',
        batchPrefix: 'Shutdown Test',
        commitMode: 'batch',
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'shutdown.alog'), 'shutdown content');
    runtime.emitFileEvent('shutdown.alog');
    await sleep(10);

    runtime.emitSignal('SIGINT');
    await sleep(10);

    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(runtime.hasSignalListener('SIGINT')).toBe(true);

    let settled = false;
    void sessionPromise.then(() => {
      settled = true;
    });

    runtime.emitSignal('SIGINT');
    await sleep(10);

    expect(settled).toBe(false);
    expect(stderrOutput.join('')).toContain('Shutdown already in progress (SIGINT)');

    resolveImport?.(createImportResult(303));
    await sessionPromise;

    expect(runtime.hasSignalListener('SIGINT')).toBe(false);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('fails closed before reading inventory when the bound watch session expires', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-expired-session-'));
    const runtime = createRuntime();
    delete runtime.runtime.sessionTokenProvider;
    const expiredCredentialContext = {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    } as never;

    const sessionPromise = startWatch(
      expiredCredentialContext,
      'user-expired',
      watchDir,
      {
        coffeeId: 0,
        coffeeName: 'auto-match',
        batchPrefix: 'Roast',
        commitMode: 'batch',
        autoMatch: true,
      },
      runtime.runtime
    );

    await sleep(10);
    await writeFile(join(watchDir, 'expired.alog'), 'expired session content');
    runtime.emitFileEvent('expired.alog');
    await sleep(10);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.runtime.inventoryLister).not.toHaveBeenCalled();
    expect(runtime.roastImporter).not.toHaveBeenCalled();
    expect(session.imports[0]).toMatchObject({
      fileName: 'expired.alog',
      status: 'needs-review',
      error:
        'Failed to fetch inventory: Session expired mid-watch. Run `purvey auth login` and retry.',
    });

    await rm(watchDir, { recursive: true, force: true });
  });
});

describe('startWatch session batch', () => {
  const WEDNESDAY = {
    coffeeId: 7,
    coffeeName: 'Ethiopia Guji',
    batchPrefix: 'wednesday',
    commitMode: 'batch' as const,
  };

  /** Importer that saves each roast into the fake batch store, numbering roasts from `firstRoastId`. */
  function saveRoastsInto(runtime: ReturnType<typeof createRuntime>, firstRoastId: number) {
    let nextRoastId = firstRoastId;
    runtime.roastImporter.mockImplementation(async (args: { batchId?: string }) => {
      const roastId = nextRoastId++;
      const batchId = args.batchId ?? `own-batch-of-${roastId}`;
      if (args.batchId) runtime.batches.attach(args.batchId, roastId);
      return { ...createImportResult(roastId), batch_id: batchId };
    });
  }

  /** Poll instead of sleeping a fixed time, so a busy machine cannot reorder the steps. */
  async function waitUntil(condition: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await sleep(2);
    }
  }

  /** The watch is ready once it is listening for both file events and the stop signal. */
  async function watching(runtime: ReturnType<typeof createRuntime>) {
    await waitUntil(() => runtime.hasSignalListener('SIGINT'), 'the watch to start');
  }

  /** Detect each file in turn, waiting until the session has recorded it before the next. */
  async function dropFiles(
    runtime: ReturnType<typeof createRuntime>,
    watchDir: string,
    fileNames: string[]
  ) {
    await watching(runtime);
    for (const fileName of fileNames) {
      await writeFile(join(watchDir, fileName), `${fileName} content`);
      runtime.emitFileEvent(fileName);
      await waitUntil(
        () =>
          runtime.saveWatchSessionImpl.mock.calls.some(([saved]) =>
            (saved as { imports: Array<{ fileName: string }> }).imports.some(
              (record) => record.fileName === fileName
            )
          ),
        `${fileName} to be recorded`
      );
    }
  }

  it('opens one batch for the run and saves every roast into it by ID', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-id-'));
    const runtime = createRuntime();
    saveRoastsInto(runtime, 301);

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      // Started late in the evening; the files are saved after midnight.
      { ...WEDNESDAY, startedAt: new Date(2026, 8, 30, 23, 40).toISOString() },
      runtime.runtime
    );
    await dropFiles(runtime, watchDir, ['first.alog', 'second.alog', 'third.alog']);

    // Nothing is opened until a roast is about to be saved.
    expect(runtime.batches.store.create).not.toHaveBeenCalled();

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).toHaveBeenCalledTimes(1);
    expect(runtime.batches.store.create).toHaveBeenCalledWith({
      name: 'wednesday',
      batchDate: '2026-09-30',
    });
    expect(runtime.roastImporter.mock.calls.map(([args]) => [args.fileName, args.batchId])).toEqual(
      [
        ['first.alog', SESSION_BATCH_ID],
        ['second.alog', SESSION_BATCH_ID],
        ['third.alog', SESSION_BATCH_ID],
      ]
    );
    expect(runtime.batches.batches.get(SESSION_BATCH_ID)?.roastIds).toEqual([301, 302, 303]);
    expect(runtime.batches.store.delete).not.toHaveBeenCalled();

    // The session keeps the batch for --resume, and each roast keeps its position.
    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(session.batchOpenedBySession).toBe(true);
    expect(
      session.imports.map((record) => [record.sequence, record.roastId, record.batchId])
    ).toEqual([
      [1, 301, SESSION_BATCH_ID],
      [2, 302, SESSION_BATCH_ID],
      [3, 303, SESSION_BATCH_ID],
    ]);
    expect(runtime.saveWatchSessionImpl).toHaveBeenLastCalledWith(
      expect.objectContaining({ batchId: SESSION_BATCH_ID, batchOpenedBySession: true })
    );
    expect(stderrOutput.join('')).toContain(`Batch: "wednesday" (batch ID ${SESSION_BATCH_ID})`);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('opens a new batch even when the name is already in use', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-repeat-'));
    const lastWeek = '99999999-9999-4999-8999-999999999999';
    const runtime = createRuntime();
    runtime.batches.seed({
      id: lastWeek,
      name: 'wednesday',
      batchDate: '2026-09-23',
      roastIds: [201, 202],
    });
    saveRoastsInto(runtime, 301);

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await dropFiles(runtime, watchDir, ['first.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(runtime.batches.batches.get(lastWeek)?.roastIds).toEqual([201, 202]);
    expect(runtime.batches.batches.get(SESSION_BATCH_ID)?.roastIds).toEqual([301]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('resumes into the batch ID saved with the session', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-resume-'));
    const runtime = createRuntime();
    runtime.batches.seed({
      id: SESSION_BATCH_ID,
      name: 'wednesday',
      batchDate: '2026-09-30',
      roastIds: [501],
    });
    saveRoastsInto(runtime, 502);
    await writeFile(join(watchDir, 'queued.alog'), 'queued content');

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        ...WEDNESDAY,
        startedAt: '2026-09-30T18:00:00.000Z',
        resumeBatchId: SESSION_BATCH_ID,
        resumeBatchOpenedBySession: true,
        resumeImports: [
          {
            fileName: 'done.alog',
            roastId: 501,
            batchName: 'wednesday',
            batchId: SESSION_BATCH_ID,
            sequence: 1,
            status: 'success',
            importedAt: '2026-09-30T18:10:00.000Z',
          },
          {
            fileName: 'queued.alog',
            roastId: null,
            batchName: 'wednesday',
            sequence: 2,
            status: 'pending',
            importedAt: '2026-09-30T18:20:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
        ],
      },
      runtime.runtime
    );
    await dropFiles(runtime, watchDir, ['next.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).not.toHaveBeenCalled();
    expect(runtime.batches.store.batchIdForRoast).not.toHaveBeenCalled();
    expect(runtime.roastImporter.mock.calls.map(([args]) => [args.fileName, args.batchId])).toEqual(
      [
        ['queued.alog', SESSION_BATCH_ID],
        ['next.alog', SESSION_BATCH_ID],
      ]
    );
    expect(runtime.batches.batches.get(SESSION_BATCH_ID)?.roastIds).toEqual([501, 502, 503]);
    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(session.imports.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(stderrOutput.join('')).toContain(`batch: "wednesday", batch ID ${SESSION_BATCH_ID}`);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('continues a session saved with only a batch name in the batch that holds its first roast', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-legacy-'));
    const firstNight = '44444444-4444-4444-8444-444444444444';
    const afterMidnight = '55555555-5555-4555-8555-555555555555';
    const runtime = createRuntime();
    // Saved by name before batches had IDs: grouped by name and roast date, so a
    // session that ran past midnight was stored as two batches.
    runtime.batches.seed({
      id: firstNight,
      name: 'wednesday',
      batchDate: '2026-09-30',
      roastIds: [501, 502],
    });
    runtime.batches.seed({
      id: afterMidnight,
      name: 'wednesday',
      batchDate: '2026-10-01',
      roastIds: [503],
    });
    saveRoastsInto(runtime, 504);

    const savedRoast = (roastId: number, sequence: number) => ({
      fileName: `saved-${sequence}.alog`,
      roastId,
      batchName: 'wednesday',
      sequence,
      status: 'success' as const,
      importedAt: '2026-09-30T23:50:00.000Z',
    });

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        ...WEDNESDAY,
        startedAt: '2026-09-30T23:00:00.000Z',
        resumeImports: [savedRoast(501, 1), savedRoast(502, 2), savedRoast(503, 3)],
      },
      runtime.runtime
    );
    await dropFiles(runtime, watchDir, ['next.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.batchIdForRoast).toHaveBeenCalledWith(501);
    expect(runtime.batches.store.create).not.toHaveBeenCalled();
    expect(runtime.roastImporter).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'next.alog', batchId: firstNight })
    );
    expect(session.batchId).toBe(firstNight);
    // The session joined a batch that already existed, so it is never removed as unused.
    expect(session.batchOpenedBySession).toBe(false);
    expect(runtime.batches.store.delete).not.toHaveBeenCalled();
    expect(session.imports.map((record) => [record.roastId, record.batchId])).toEqual([
      [501, firstNight],
      [502, firstNight],
      [503, undefined],
      [504, firstNight],
    ]);

    const output = stderrOutput.join('');
    expect(output).toContain(
      '1 roast saved earlier in this session is in a different batch: #503.'
    );
    expect(output).toContain(`purvey roast update <roast-id> --batch-id ${firstNight}`);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('opens a batch for a name-only session that has not saved a roast yet', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-legacy-empty-'));
    const runtime = createRuntime();
    saveRoastsInto(runtime, 601);
    await writeFile(join(watchDir, 'queued.alog'), 'queued content');

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        ...WEDNESDAY,
        resumeImports: [
          {
            fileName: 'queued.alog',
            roastId: null,
            batchName: 'wednesday',
            sequence: 1,
            status: 'pending',
            importedAt: '2026-09-30T18:20:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
        ],
      },
      runtime.runtime
    );
    await watching(runtime);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).toHaveBeenCalledTimes(1);
    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(session.imports[0]).toMatchObject({ roastId: 601, batchId: SESSION_BATCH_ID });

    await rm(watchDir, { recursive: true, force: true });
  });

  it('starts a new batch when the saved batch no longer exists', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-gone-'));
    const deleted = '66666666-6666-4666-8666-666666666666';
    const runtime = createRuntime();
    saveRoastsInto(runtime, 701);

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      { ...WEDNESDAY, resumeBatchId: deleted, resumeBatchOpenedBySession: true },
      runtime.runtime
    );
    await dropFiles(runtime, watchDir, ['next.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.get).toHaveBeenCalledWith(deleted);
    expect(runtime.batches.store.create).toHaveBeenCalledTimes(1);
    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(stderrOutput.join('')).toContain(
      `Batch ${deleted} no longer exists. New roasts from this session go into a new batch.`
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('opens no batch when the session saves no roasts', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-none-'));
    const runtime = createRuntime();

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await watching(runtime);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).not.toHaveBeenCalled();
    expect(runtime.batches.store.delete).not.toHaveBeenCalled();
    expect(session.batchId).toBeUndefined();

    await rm(watchDir, { recursive: true, force: true });
  });

  it('removes the batch it opened when every import fails', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-cleanup-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockRejectedValue(new Error('Roast writes are not enabled'));

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await dropFiles(runtime, watchDir, ['first.alog', 'second.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).toHaveBeenCalledTimes(1);
    expect(runtime.batches.store.delete).toHaveBeenCalledTimes(1);
    expect(runtime.batches.store.delete).toHaveBeenCalledWith(SESSION_BATCH_ID);
    expect(runtime.batches.batches.has(SESSION_BATCH_ID)).toBe(false);
    expect(session.batchId).toBeUndefined();
    expect(session.imports.map((record) => record.status)).toEqual(['failed', 'failed']);
    expect(runtime.saveWatchSessionImpl).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ batchId: expect.anything() })
    );
    expect(stderrOutput.join('')).toContain(
      'Removed the empty batch "wednesday" opened for this session; no roasts were saved into it.'
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('keeps the batch when it holds a roast, even if this run recorded no success', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-keep-'));
    const runtime = createRuntime();
    // The roast was saved, but the response was lost before the CLI recorded it.
    runtime.roastImporter.mockImplementation(async (args: { batchId?: string }) => {
      if (args.batchId) runtime.batches.attach(args.batchId, 801);
      throw new Error('socket hang up');
    });

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await dropFiles(runtime, watchDir, ['first.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.delete).not.toHaveBeenCalled();
    expect(runtime.batches.batches.get(SESSION_BATCH_ID)?.roastIds).toEqual([801]);
    expect(session.batchId).toBe(SESSION_BATCH_ID);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('says how to remove the empty batch when the cleanup itself fails', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-cleanup-fails-'));
    const runtime = createRuntime();
    runtime.roastImporter.mockRejectedValue(new Error('offline'));
    runtime.batches.store.delete.mockRejectedValue(new Error('offline'));

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await dropFiles(runtime, watchDir, ['first.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    // The batch stays in the session, so --resume reuses it instead of opening another.
    expect(session.batchId).toBe(SESSION_BATCH_ID);
    expect(stderrOutput.join('')).toContain(
      `Remove it with: purvey roast-batch delete ${SESSION_BATCH_ID}`
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it('fails the roast when the batch cannot be opened and tries again for the next one', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-open-fails-'));
    const runtime = createRuntime();
    saveRoastsInto(runtime, 901);
    runtime.batches.store.create.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const sessionPromise = startWatch({} as never, 'user-1', watchDir, WEDNESDAY, runtime.runtime);
    await dropFiles(runtime, watchDir, ['first.alog', 'second.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).toHaveBeenCalledTimes(2);
    expect(runtime.roastImporter).toHaveBeenCalledTimes(1);
    expect(session.imports.map((record) => [record.fileName, record.status, record.error])).toEqual(
      [
        ['first.alog', 'failed', 'rate limit exceeded'],
        ['second.alog', 'success', undefined],
      ]
    );
    expect(session.imports[1]?.batchId).toBe(SESSION_BATCH_ID);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('points manual recovery at the session batch', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-recovery-'));
    const runtime = createRuntime();
    saveRoastsInto(runtime, 1001);
    await writeFile(join(watchDir, 'queued.alog'), 'queued content');

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      {
        ...WEDNESDAY,
        resumeImports: [
          {
            fileName: 'queued.alog',
            roastId: null,
            batchName: 'wednesday',
            sequence: 1,
            status: 'pending',
            importedAt: '2026-09-30T18:20:00.000Z',
            selectedCoffeeId: 7,
            selectedCoffeeName: 'Ethiopia Guji',
          },
          {
            fileName: 'unmatched.alog',
            roastId: null,
            batchName: 'wednesday',
            sequence: 2,
            status: 'needs-review',
            error: 'Low AI confidence (20%)',
            importedAt: '2026-09-30T18:25:00.000Z',
          },
        ],
      },
      runtime.runtime
    );
    await watching(runtime);
    runtime.emitSignal('SIGINT');
    await sessionPromise;

    expect(stderrOutput.join('')).toContain(
      `purvey roast import <file> --coffee-id <id> --batch-id ${SESSION_BATCH_ID}`
    );

    await rm(watchDir, { recursive: true, force: true });
  });

  it("does not open a session batch in individual mode and records each roast's own batch", async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-individual-'));
    const runtime = createRuntime();
    saveRoastsInto(runtime, 1101);

    const sessionPromise = startWatch(
      {} as never,
      'user-1',
      watchDir,
      { ...WEDNESDAY, commitMode: 'individual' },
      runtime.runtime
    );
    await dropFiles(runtime, watchDir, ['first.alog', 'second.alog']);
    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.batches.store.create).not.toHaveBeenCalled();
    expect(runtime.batches.store.get).not.toHaveBeenCalled();
    expect(runtime.batches.store.delete).not.toHaveBeenCalled();
    expect(
      runtime.roastImporter.mock.calls.map(([args]) => [args.batchName, args.batchId])
    ).toEqual([
      ['wednesday #1', undefined],
      ['wednesday #2', undefined],
    ]);
    expect(session.batchId).toBeUndefined();
    expect(session.imports.map((record) => [record.sequence, record.batchId])).toEqual([
      [1, 'own-batch-of-1101'],
      [2, 'own-batch-of-1102'],
    ]);

    await rm(watchDir, { recursive: true, force: true });
  });

  it('requires batch access in batch commit mode', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-batch-required-'));
    const { runtime } = createRuntime();

    await expect(
      startWatch({} as never, 'user-1', watchDir, WEDNESDAY, { ...runtime, batchStore: undefined })
    ).rejects.toThrow('startWatch requires a batchStore in batch commit mode.');

    await rm(watchDir, { recursive: true, force: true });
  });
});
