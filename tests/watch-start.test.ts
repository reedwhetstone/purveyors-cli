import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import type { FSWatcher } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startWatch, type StartWatchRuntime } from '../src/lib/interactive/watch.js';

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
  const importRoastFromFileImpl = vi.fn();
  const signalListeners = new Map<'SIGINT' | 'SIGTERM', () => void>();

  const runtime: StartWatchRuntime = {
    debounceMs: 1,
    saveWatchSessionImpl: vi.fn().mockResolvedValue(undefined),
    importRoastFromFileImpl,
    addSignalListener: vi.fn((signal, listener) => {
      signalListeners.set(signal, listener);
    }),
    removeSignalListener: vi.fn((signal) => {
      signalListeners.delete(signal);
    }),
    watchImpl: vi.fn((_directory, _options, registeredCallback) => {
      callback = registeredCallback as (eventType: string, filename: string) => void;
      return { close } as unknown as FSWatcher;
    }),
  };

  return {
    runtime,
    close,
    importRoastFromFileImpl,
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
    hasSignalListener(signal: 'SIGINT' | 'SIGTERM') {
      return signalListeners.has(signal);
    },
  };
}

beforeEach(() => {
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
    runtime.importRoastFromFileImpl.mockResolvedValue(createImportResult(101));

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

    expect(runtime.importRoastFromFileImpl).not.toHaveBeenCalled();

    runtime.emitSignal('SIGINT');
    const session = await sessionPromise;

    expect(runtime.importRoastFromFileImpl).toHaveBeenCalledTimes(1);
    expect(runtime.importRoastFromFileImpl).toHaveBeenCalledWith(
      {},
      'user-1',
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

  it('rehydrates pending resume imports and finalizes them on shutdown', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-resume-'));
    const runtime = createRuntime();
    runtime.importRoastFromFileImpl.mockResolvedValue(createImportResult(202));
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

    expect(runtime.importRoastFromFileImpl).toHaveBeenCalledTimes(1);
    expect(runtime.importRoastFromFileImpl).toHaveBeenCalledWith(
      {},
      'user-2',
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

  it('keeps shutdown idempotent when a second signal arrives during batch finalization', async () => {
    const watchDir = await mkdtemp(join(tmpdir(), 'purvey-watch-shutdown-'));
    const runtime = createRuntime();
    let resolveImport: ((value: ReturnType<typeof createImportResult>) => void) | undefined;

    runtime.importRoastFromFileImpl.mockImplementation(
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

    expect(runtime.importRoastFromFileImpl).toHaveBeenCalledTimes(1);
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
});
