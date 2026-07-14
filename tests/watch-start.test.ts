import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import type { FSWatcher } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startWatch, type StartWatchRuntime } from '../src/lib/interactive/watch.js';

const { pickBeanMock, guardCancelMock, classifyRoastMock, processAlogFileMock } = vi.hoisted(
  () => ({
    pickBeanMock: vi.fn(),
    guardCancelMock: vi.fn(),
    classifyRoastMock: vi.fn(),
    processAlogFileMock: vi.fn(),
  })
);

vi.mock('../src/lib/interactive/forms.js', () => ({
  pickBean: pickBeanMock,
  guardCancel: guardCancelMock,
}));

vi.mock('../src/lib/ai.js', () => ({
  classifyRoast: classifyRoastMock,
}));

vi.mock('../src/lib/artisan/parser.js', () => ({
  processAlogFile: processAlogFileMock,
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
  const signalListeners = new Map<'SIGINT' | 'SIGTERM', () => void>();
  let exitKeyListener: (() => void) | null = null;
  const cleanupExitKeyListener = vi.fn(() => {
    exitKeyListener = null;
  });

  const runtime: StartWatchRuntime = {
    debounceMs: 1,
    saveWatchSessionImpl,
    roastImporter,
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
  processAlogFileMock.mockReset();
  processAlogFileMock.mockReturnValue({ title: 'Roaster Scope' });

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
        batchName: 'Ethiopia Guji #1',
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

    processAlogFileMock.mockReturnValue({ title: 'Exit Key Roast' });
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
