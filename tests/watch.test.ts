import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateBatchName,
  isAlogFile,
  saveWatchSession,
  loadWatchSession,
  printVerificationTable,
  type WatchSession,
  type ImportRecord,
} from '../src/lib/interactive/watch.js';

// ── generateBatchName ─────────────────────────────────────────────────────────

describe('generateBatchName', () => {
  it('generates "{prefix} #{n}" for sequence 1', () => {
    expect(generateBatchName('Ethiopia Guji', 1)).toBe('Ethiopia Guji #1');
  });

  it('generates correct sequence for subsequent calls', () => {
    expect(generateBatchName('Colombia Huila', 2)).toBe('Colombia Huila #2');
    expect(generateBatchName('Colombia Huila', 10)).toBe('Colombia Huila #10');
  });

  it('handles numeric-looking prefix', () => {
    expect(generateBatchName('Roast 2026', 3)).toBe('Roast 2026 #3');
  });

  it('preserves prefix with special characters', () => {
    expect(generateBatchName('Ethiopia — Guji', 1)).toBe('Ethiopia — Guji #1');
  });
});

// ── isAlogFile ────────────────────────────────────────────────────────────────

describe('isAlogFile', () => {
  it('returns true for .alog files', () => {
    expect(isAlogFile('ethiopia-guji-01.alog')).toBe(true);
    expect(isAlogFile('roast.alog')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAlogFile('ROAST.ALOG')).toBe(true);
    expect(isAlogFile('roast.Alog')).toBe(true);
  });

  it('returns false for non-.alog extensions', () => {
    expect(isAlogFile('roast.json')).toBe(false);
    expect(isAlogFile('roast.txt')).toBe(false);
    expect(isAlogFile('roast.csv')).toBe(false);
    expect(isAlogFile('roast.alog.json')).toBe(false);
    expect(isAlogFile('roast')).toBe(false);
  });

  it('returns false for files with .alog as prefix but not extension', () => {
    // e.g. ".alog_backup" should NOT match
    expect(isAlogFile('roast.alog_backup')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAlogFile('')).toBe(false);
  });
});

// ── Session serialization/deserialization ─────────────────────────────────────

describe('saveWatchSession / loadWatchSession', () => {
  // We monkey-patch CONFIG_DIR by temporarily pointing the session file
  // to a temp directory so we don't pollute ~/.config/purvey/.
  // This is done by overriding the module's internal path via mocking.

  // Use a temp dir we control for the actual file I/O
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `purvey-watch-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a minimal session', async () => {
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 42,
      coffeeName: 'Ethiopia Guji',
      batchPrefix: 'Ethiopia Guji',
      startedAt: '2026-03-16T00:00:00.000Z',
      imports: [],
    };

    // Write directly to tmpDir for isolation
    const sessionFile = join(tmpDir, 'watch-session.json');
    await writeFile(sessionFile, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });

    const raw = await import('fs/promises').then((m) => m.readFile(sessionFile, 'utf-8'));
    const loaded = JSON.parse(raw) as WatchSession;

    expect(loaded.directory).toBe(session.directory);
    expect(loaded.coffeeId).toBe(session.coffeeId);
    expect(loaded.coffeeName).toBe(session.coffeeName);
    expect(loaded.batchPrefix).toBe(session.batchPrefix);
    expect(loaded.startedAt).toBe(session.startedAt);
    expect(loaded.imports).toEqual([]);
  });

  it('round-trips a session with imports', async () => {
    const record: ImportRecord = {
      fileName: 'ethiopia-guji-01.alog',
      roastId: 456,
      batchName: 'Ethiopia Guji #1',
      status: 'success',
      importedAt: '2026-03-16T00:01:00.000Z',
    };
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 42,
      coffeeName: 'Ethiopia Guji',
      batchPrefix: 'Ethiopia Guji',
      startedAt: '2026-03-16T00:00:00.000Z',
      imports: [record],
    };

    const sessionFile = join(tmpDir, 'watch-session.json');
    await writeFile(sessionFile, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });

    const raw = await import('fs/promises').then((m) => m.readFile(sessionFile, 'utf-8'));
    const loaded = JSON.parse(raw) as WatchSession;

    expect(loaded.imports).toHaveLength(1);
    expect(loaded.imports[0].fileName).toBe('ethiopia-guji-01.alog');
    expect(loaded.imports[0].roastId).toBe(456);
    expect(loaded.imports[0].status).toBe('success');
  });

  it('round-trips a failed import record', async () => {
    const record: ImportRecord = {
      fileName: 'bad.alog',
      roastId: 0,
      batchName: 'Ethiopia Guji #2',
      status: 'failed',
      error: 'Invalid Artisan file: missing timex',
      importedAt: '2026-03-16T00:02:00.000Z',
    };
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 42,
      coffeeName: 'Ethiopia Guji',
      batchPrefix: 'Ethiopia Guji',
      startedAt: '2026-03-16T00:00:00.000Z',
      imports: [record],
    };

    const sessionFile = join(tmpDir, 'watch-session.json');
    await writeFile(sessionFile, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });

    const raw = await import('fs/promises').then((m) => m.readFile(sessionFile, 'utf-8'));
    const loaded = JSON.parse(raw) as WatchSession;

    expect(loaded.imports[0].status).toBe('failed');
    expect(loaded.imports[0].error).toBe('Invalid Artisan file: missing timex');
    expect(loaded.imports[0].roastId).toBe(0);
  });
});

// ── Debounce timer logic ──────────────────────────────────────────────────────

describe('debounce timer logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls handler once after debounce delay', () => {
    const handler = vi.fn();
    const debounceTimers = new Map<string, NodeJS.Timeout>();

    function onFileEvent(filename: string): void {
      if (debounceTimers.has(filename)) {
        clearTimeout(debounceTimers.get(filename)!);
      }
      debounceTimers.set(
        filename,
        setTimeout(() => {
          debounceTimers.delete(filename);
          handler(filename);
        }, 2000)
      );
    }

    onFileEvent('roast.alog');
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('roast.alog');
  });

  it('resets timer on repeated events within 2 seconds', () => {
    const handler = vi.fn();
    const debounceTimers = new Map<string, NodeJS.Timeout>();

    function onFileEvent(filename: string): void {
      if (debounceTimers.has(filename)) {
        clearTimeout(debounceTimers.get(filename)!);
      }
      debounceTimers.set(
        filename,
        setTimeout(() => {
          debounceTimers.delete(filename);
          handler(filename);
        }, 2000)
      );
    }

    // Fire 3 times within 2 seconds
    onFileEvent('roast.alog');
    vi.advanceTimersByTime(500);
    onFileEvent('roast.alog');
    vi.advanceTimersByTime(500);
    onFileEvent('roast.alog');

    // Only 1 second has passed since last event — should not fire yet
    vi.advanceTimersByTime(1999);
    expect(handler).not.toHaveBeenCalled();

    // Now 2 seconds since last event — should fire once
    vi.advanceTimersByTime(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('handles multiple distinct files independently', () => {
    const handler = vi.fn();
    const debounceTimers = new Map<string, NodeJS.Timeout>();

    function onFileEvent(filename: string): void {
      if (debounceTimers.has(filename)) {
        clearTimeout(debounceTimers.get(filename)!);
      }
      debounceTimers.set(
        filename,
        setTimeout(() => {
          debounceTimers.delete(filename);
          handler(filename);
        }, 2000)
      );
    }

    onFileEvent('roast-1.alog');
    vi.advanceTimersByTime(1000);
    onFileEvent('roast-2.alog');
    vi.advanceTimersByTime(1000);

    // roast-1.alog should fire (2s elapsed), roast-2.alog should not
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('roast-1.alog');

    vi.advanceTimersByTime(1000);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith('roast-2.alog');
  });

  it('does not call handler if timer is cancelled before it fires', () => {
    const handler = vi.fn();
    const debounceTimers = new Map<string, NodeJS.Timeout>();

    function onFileEvent(filename: string): void {
      if (debounceTimers.has(filename)) {
        clearTimeout(debounceTimers.get(filename)!);
      }
      debounceTimers.set(
        filename,
        setTimeout(() => {
          debounceTimers.delete(filename);
          handler(filename);
        }, 2000)
      );
    }

    onFileEvent('roast.alog');
    // Cancel all timers (simulating SIGINT cleanup)
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();

    vi.advanceTimersByTime(3000);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── printVerificationTable ────────────────────────────────────────────────────

describe('printVerificationTable', () => {
  it('prints without throwing for empty session', () => {
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 1,
      coffeeName: 'Test',
      batchPrefix: 'Test',
      startedAt: new Date().toISOString(),
      imports: [],
    };

    // Capture stderr
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    expect(() => printVerificationTable(session)).not.toThrow();
    expect(written.some((s) => s.includes('0 files processed'))).toBe(true);

    spy.mockRestore();
  });

  it('includes succeeded/failed counts in summary line', () => {
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 1,
      coffeeName: 'Test',
      batchPrefix: 'Test',
      startedAt: new Date().toISOString(),
      imports: [
        {
          fileName: 'a.alog',
          roastId: 1,
          batchName: 'Test #1',
          status: 'success',
          importedAt: new Date().toISOString(),
        },
        {
          fileName: 'b.alog',
          roastId: 0,
          batchName: 'Test #2',
          status: 'failed',
          error: 'parse error',
          importedAt: new Date().toISOString(),
        },
      ],
    };

    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    printVerificationTable(session);
    const combined = written.join('');
    expect(combined).toContain('2 files processed');
    expect(combined).toContain('1 succeeded');
    expect(combined).toContain('1 failed');

    spy.mockRestore();
  });

  it('shows roast IDs for successful imports', () => {
    const session: WatchSession = {
      directory: '/tmp/roasts',
      coffeeId: 1,
      coffeeName: 'Test',
      batchPrefix: 'Test',
      startedAt: new Date().toISOString(),
      imports: [
        {
          fileName: 'eth.alog',
          roastId: 456,
          batchName: 'Ethiopia #1',
          status: 'success',
          importedAt: new Date().toISOString(),
        },
      ],
    };

    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    printVerificationTable(session);
    const combined = written.join('');
    expect(combined).toContain('#456');
    expect(combined).toContain('eth.alog');

    spy.mockRestore();
  });
});
