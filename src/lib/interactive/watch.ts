/**
 * Watch module for `purvey roast watch`.
 * CLI-only — not exported via package.json subpaths.
 *
 * Monitors a directory for new .alog files, queues or imports them,
 * and shows a verification table when the session ends (Ctrl+C).
 */

import { watch, type FSWatcher } from 'fs';
import { readFile, access, writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { constants } from 'fs';
import type { CredentialContext } from '../auth-client.js';
import type { ImportRoastResult } from '../roast.js';
import { CONFIG_DIR } from '../config.js';
import { listInventory } from '../inventory.js';
import { AuthError } from '../errors.js';
import { localDateIso } from '../prompts.js';

// ─── Roast importer seam ────────────────────────────────────────────────────

/**
 * Arguments for a single watched roast import. Identity is resolved by the
 * importer itself (session JWT / API key), so the watcher never handles the
 * caller's credentials directly.
 */
export interface WatchRoastImportArgs {
  fileContent: string;
  fileName: string;
  coffeeId: number;
  batchName: string;
  /** Batch to save the roast in, by id. When set, the roast takes that batch's name. */
  batchId?: string;
  ozIn?: number;
  roastNotes?: string;
  roastTargets?: string;
}

/**
 * Imports one .alog roast and returns the CLI's canonical import result shape.
 * The production implementation forwards to the Parchment API via the SDK
 * (`client.roasts.import`); the raw `.alog` is parsed and persisted server-side.
 */
export type WatchRoastImporter = (args: WatchRoastImportArgs) => Promise<ImportRoastResult>;

// ─── Session batch seam ─────────────────────────────────────────────────────

export interface WatchBatchRecord {
  id: string;
  name: string;
  batchDate: string;
  /** Roasts currently in the batch. */
  roastIds: number[];
}

/**
 * Batch access for a batch-mode watch session. Like the importer, the production
 * implementation resolves the caller's identity itself.
 */
export interface WatchBatchStore {
  /** Open a new, empty batch. An existing batch with the same name is left alone. */
  create(input: { name: string; batchDate: string }): Promise<WatchBatchRecord>;
  /** Read one batch, or null when it no longer exists. */
  get(batchId: string): Promise<WatchBatchRecord | null>;
  /** Delete a batch and any roasts in it. */
  delete(batchId: string): Promise<void>;
  /** The batch a saved roast is in, or null when the roast no longer exists. */
  batchIdForRoast(roastId: number): Promise<string | null>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchSession {
  directory: string;
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  promptEach?: boolean;
  autoMatch?: boolean;
  interactiveRecovery?: boolean;
  commitMode?: 'batch' | 'individual';
  /**
   * Batch commit mode: the one batch every roast of this session is saved in.
   * Absent until the first roast is saved, and in sessions saved before batches
   * had ids.
   */
  batchId?: string;
  /** True when this session opened `batchId` itself, rather than joining a batch that already held its roasts. */
  batchOpenedBySession?: boolean;
  ozIn?: number;
  roastNotes?: string;
  roastTargets?: string;
  startedAt: string;
  imports: ImportRecord[];
}

export interface ImportRecord {
  fileName: string;
  roastId: number | null;
  /** Batch name the roast is saved under. Batch commit mode shares one name across the session. */
  batchName: string;
  /** Id of the batch the roast was saved in. Absent on roasts saved before batches had ids. */
  batchId?: string;
  /** 1-based position of this file in the watch session; identifies the roast within a shared batch. */
  sequence?: number;
  status: 'pending' | 'success' | 'failed' | 'needs-review';
  error?: string;
  milestones?: ImportRoastResult['milestones'];
  phases?: ImportRoastResult['phases'];
  importedAt: string;
  selectedCoffeeId?: number;
  selectedCoffeeName?: string;
  // AI matching fields
  aiMatch?: {
    coffeeName: string;
    confidence: number;
    reasoning: string;
  };
  matchMethod?: 'inventory' | 'ai';
}

interface StartWatchOpts {
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  commitMode?: 'batch' | 'individual';
  startedAt?: string;
  resumeImports?: ImportRecord[];
  /** Batch a resumed session was saving into, with whether that session opened it. */
  resumeBatchId?: string;
  resumeBatchOpenedBySession?: boolean;
  promptEach?: boolean;
  autoMatch?: boolean;
  interactiveRecovery?: boolean;
  ozIn?: number;
  roastNotes?: string;
  roastTargets?: string;
}

export interface StartWatchRuntime {
  accessImpl?: typeof access;
  readFileImpl?: typeof readFile;
  readdirImpl?: (typeof import('fs/promises'))['readdir'];
  saveWatchSessionImpl?: typeof saveWatchSession;
  roastImporter?: WatchRoastImporter;
  /** Required in batch commit mode, where the session saves every roast into one batch. */
  batchStore?: WatchBatchStore;
  watchImpl?: typeof watch;
  addSignalListener?: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
  removeSignalListener?: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
  addExitKeyListener?: (listener: () => void) => () => void;
  debounceMs?: number;
  sessionTokenProvider?: () => Promise<string | undefined>;
  inventoryLister?: typeof listInventory;
}

function addDefaultExitKeyListener(listener: () => void): () => void {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };

  if (!stdin.isTTY) return () => {};

  const wasRaw = stdin.isRaw ?? false;
  const wasPaused = stdin.isPaused();
  const onData = (chunk: Buffer | string): void => {
    const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    if (value.includes('\u0003')) {
      listener();
    }
  };

  stdin.on('data', onData);
  stdin.setRawMode?.(true);
  stdin.resume();

  return () => {
    stdin.off('data', onData);
    stdin.setRawMode?.(wasRaw);
    if (wasPaused) {
      stdin.pause();
    }
  };
}

interface QueuedImport {
  record: ImportRecord;
  coffeeId: number;
  coffeeName: string;
  fileContent?: string;
}

interface ManualImportRecoveryOptions {
  /** Batch the session saved its roasts in, so a manual import joins the same batch. */
  batchId?: string;
  ozIn?: number;
  roastNotes?: string;
  roastTargets?: string;
}

function quoteCliArg(value: string): string {
  return JSON.stringify(value);
}

export function buildManualImportRecoveryCommand(
  options: ManualImportRecoveryOptions = {}
): string {
  let command = 'purvey roast import <file> --coffee-id <id>';

  if (options.batchId !== undefined) {
    command += ` --batch-id ${options.batchId}`;
  }

  if (options.ozIn !== undefined) {
    command += ` --oz-in ${options.ozIn}`;
  }

  if (options.roastNotes !== undefined && options.roastNotes.trim() !== '') {
    command += ` --roast-notes ${quoteCliArg(options.roastNotes.trim())}`;
  }

  if (options.roastTargets !== undefined && options.roastTargets.trim() !== '') {
    command += ` --roast-targets ${quoteCliArg(options.roastTargets.trim())}`;
  }

  return command;
}

// ─── Session persistence ──────────────────────────────────────────────────────

const SESSION_FILE = join(CONFIG_DIR, 'watch-session.json');

/** Persist session state to disk after each import. */
export async function saveWatchSession(session: WatchSession): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}

/** Load a previously saved watch session. Returns null if none exists. */
export async function loadWatchSession(): Promise<WatchSession | null> {
  try {
    await access(SESSION_FILE, constants.R_OK);
    const raw = await readFile(SESSION_FILE, 'utf-8');
    return JSON.parse(raw) as WatchSession;
  } catch {
    return null;
  }
}

// ─── Batch name generation ────────────────────────────────────────────────────

/**
 * Generate a sequential batch name: "{prefix} #{n}".
 * sequence is 1-based (first import = 1).
 */
export function generateBatchName(prefix: string, sequence: number): string {
  return `${prefix} #${sequence}`;
}

/**
 * Batch name a watched roast is saved under.
 *
 * Batch commit mode saves every roast into one batch, named by the prefix
 * itself. Individual commit mode keeps a distinct "{prefix} #{n}" name per
 * roast, so each roast is its own batch.
 */
export function resolveWatchBatchName(
  prefix: string,
  sequence: number,
  commitMode: 'batch' | 'individual'
): string {
  return commitMode === 'batch' ? prefix : generateBatchName(prefix, sequence);
}

/**
 * Bring resumed records in line with the current session: every record gets its
 * position, and in batch commit mode roasts that are not saved yet and still
 * carry a numbered "{prefix} #{n}" name from an older saved session join the
 * shared batch. Saved roasts keep the name they were saved under.
 *
 * A record saved without a position takes the number from its numbered name
 * when it has one, so a name that is already in use is never handed out again.
 */
function normalizeResumedImports(
  records: ImportRecord[],
  batchPrefix: string,
  commitMode: 'batch' | 'individual'
): ImportRecord[] {
  const numberedPrefix = `${batchPrefix} #`;
  const numberedPosition = (name: string): number | undefined => {
    if (!name.startsWith(numberedPrefix)) return undefined;
    const suffix = name.slice(numberedPrefix.length);
    if (!/^\d+$/.test(suffix)) return undefined;
    const position = Number(suffix);
    return Number.isSafeInteger(position) && position >= 1 ? position : undefined;
  };

  return records.map((record, index) => {
    const numbered = numberedPosition(record.batchName);
    return {
      ...record,
      sequence: record.sequence ?? numbered ?? index + 1,
      batchName:
        commitMode === 'batch' && record.status !== 'success' && numbered !== undefined
          ? batchPrefix
          : record.batchName,
    };
  });
}

/**
 * First position to hand out in this session. Continues after the highest
 * position already claimed rather than the record count: a session interrupted
 * while files were importing out of order can be saved with a gap, and counting
 * records would hand an existing position (and numbered name) out again.
 */
function nextSequenceAfter(records: ImportRecord[]): number {
  return (
    records.reduce((highest, record) => Math.max(highest, record.sequence ?? 0), records.length) + 1
  );
}

/** Position label for the summary tables; falls back to row order for older saved sessions. */
function sequenceLabel(record: ImportRecord, index: number): string {
  return String(record.sequence ?? index + 1);
}

// ─── File extension filter ────────────────────────────────────────────────────

/** Returns true if filename has a .alog extension (case-insensitive). */
export function isAlogFile(filename: string): boolean {
  return extname(filename).toLowerCase() === '.alog';
}

// ─── Verification table ───────────────────────────────────────────────────────

/** Render a padded verification table and print to stderr. */
export function printVerificationTable(session: WatchSession, autoMatch?: boolean): void {
  const imports = session.imports;
  const showAiColumns = autoMatch === true || imports.some((r) => r.aiMatch !== undefined);

  if (showAiColumns) {
    printVerificationTableAutoMatch(imports);
  } else {
    printVerificationTableStandard(imports);
  }

  if (session.batchId !== undefined) {
    process.stderr.write(`Batch: "${session.batchPrefix}" (batch ID ${session.batchId})\n\n`);
  }
}

function printVerificationTableStandard(imports: ImportRecord[]): void {
  // Column widths
  const COL_SEQ = 3;
  const COL_FILE = 31;
  const COL_ID = 10;
  const COL_BATCH = 26;
  const COL_STATUS = 9;

  function row(seq: string, file: string, id: string, batch: string, status: string): string {
    return (
      '│ ' +
      seq.padEnd(COL_SEQ) +
      '│ ' +
      file.padEnd(COL_FILE) +
      '│ ' +
      id.padEnd(COL_ID) +
      '│ ' +
      batch.padEnd(COL_BATCH) +
      '│ ' +
      status.padEnd(COL_STATUS) +
      '│'
    );
  }

  function hline(left: string, mid: string, right: string, fill: string): string {
    return (
      left +
      fill.repeat(COL_SEQ + 2) +
      mid +
      fill.repeat(COL_FILE + 2) +
      mid +
      fill.repeat(COL_ID + 2) +
      mid +
      fill.repeat(COL_BATCH + 2) +
      mid +
      fill.repeat(COL_STATUS + 2) +
      right
    );
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(hline('┌', '┬', '┐', '─'));
  lines.push(row('#', 'File', 'Roast ID', 'Batch', 'Status'));
  lines.push(hline('├', '┼', '┤', '─'));

  if (imports.length === 0) {
    lines.push(row('', '(no files imported)', '', '', ''));
  } else {
    for (const [index, rec] of imports.entries()) {
      const file =
        rec.fileName.length > COL_FILE ? rec.fileName.slice(0, COL_FILE - 1) + '…' : rec.fileName;
      const id = rec.status === 'success' ? `#${rec.roastId}` : '—';
      const batch =
        rec.batchName.length > COL_BATCH
          ? rec.batchName.slice(0, COL_BATCH - 1) + '…'
          : rec.batchName;
      const status =
        rec.status === 'success'
          ? '✓'
          : rec.status === 'pending'
            ? '… queued'
            : rec.status === 'needs-review'
              ? '⚠ review'
              : `✗ ${rec.error?.slice(0, 5) ?? 'Error'}`;
      lines.push(row(sequenceLabel(rec, index), file, id, batch, status));
    }
  }

  lines.push(hline('└', '┴', '┘', '─'));

  const succeeded = imports.filter((r) => r.status === 'success').length;
  const failed = imports.filter((r) => r.status === 'failed').length;
  const pending = imports.filter((r) => r.status === 'pending').length;
  const needsReview = imports.filter((r) => r.status === 'needs-review').length;
  lines.push('');
  let summary = `Session: ${imports.length} file${imports.length !== 1 ? 's' : ''} processed, ${succeeded} succeeded, ${failed} failed`;
  if (needsReview > 0) {
    summary += `, ${needsReview} need${needsReview !== 1 ? '' : 's'} review`;
  }
  if (pending > 0) {
    summary += `, ${pending} queued`;
  }
  lines.push(summary);
  lines.push('');

  process.stderr.write(lines.join('\n') + '\n');
}

function printVerificationTableAutoMatch(imports: ImportRecord[]): void {
  // Column widths for auto-match table
  const COL_SEQ = 3;
  const COL_FILE = 29;
  const COL_ID = 9;
  const COL_BEAN = 22;
  const COL_CONF = 10;
  const COL_STATUS = 7;

  function row(
    seq: string,
    file: string,
    id: string,
    bean: string,
    conf: string,
    status: string
  ): string {
    return (
      '│ ' +
      seq.padEnd(COL_SEQ) +
      '│ ' +
      file.padEnd(COL_FILE) +
      '│ ' +
      id.padEnd(COL_ID) +
      '│ ' +
      bean.padEnd(COL_BEAN) +
      '│ ' +
      conf.padEnd(COL_CONF) +
      '│ ' +
      status.padEnd(COL_STATUS) +
      '│'
    );
  }

  function hline(left: string, mid: string, right: string, fill: string): string {
    return (
      left +
      fill.repeat(COL_SEQ + 2) +
      mid +
      fill.repeat(COL_FILE + 2) +
      mid +
      fill.repeat(COL_ID + 2) +
      mid +
      fill.repeat(COL_BEAN + 2) +
      mid +
      fill.repeat(COL_CONF + 2) +
      mid +
      fill.repeat(COL_STATUS + 2) +
      right
    );
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(hline('┌', '┬', '┐', '─'));
  lines.push(row('#', 'File', 'Roast ID', 'Matched Bean', 'Confidence', 'Status'));
  lines.push(hline('├', '┼', '┤', '─'));

  if (imports.length === 0) {
    lines.push(row('', '(no files imported)', '', '', '', ''));
  } else {
    for (const [index, rec] of imports.entries()) {
      const file =
        rec.fileName.length > COL_FILE ? rec.fileName.slice(0, COL_FILE - 1) + '…' : rec.fileName;
      const id = rec.status === 'success' && rec.roastId !== null ? `#${rec.roastId}` : '—';
      const beanName =
        rec.aiMatch?.coffeeName ?? (rec.status === 'needs-review' ? '(needs review)' : '—');
      const bean = beanName.length > COL_BEAN ? beanName.slice(0, COL_BEAN - 1) + '…' : beanName;
      const confVal = rec.aiMatch !== undefined ? `${rec.aiMatch.confidence}%` : '';
      const conf = confVal.padEnd(COL_CONF);
      const status =
        rec.status === 'success'
          ? '✓'
          : rec.status === 'pending'
            ? '…'
            : rec.status === 'needs-review'
              ? '⚠'
              : `✗ ${rec.error?.slice(0, 4) ?? 'Err'}`;
      lines.push(row(sequenceLabel(rec, index), file, id, bean, conf, status));
    }
  }

  lines.push(hline('└', '┴', '┘', '─'));

  const succeeded = imports.filter((r) => r.status === 'success').length;
  const failed = imports.filter((r) => r.status === 'failed').length;
  const needsReview = imports.filter((r) => r.status === 'needs-review').length;
  const pending = imports.filter((r) => r.status === 'pending').length;
  lines.push('');
  let summary = `Session: ${imports.length} file${imports.length !== 1 ? 's' : ''} processed, ${succeeded} succeeded, ${failed} failed`;
  if (needsReview > 0) {
    summary += `, ${needsReview} need${needsReview !== 1 ? '' : 's'} review`;
  }
  if (pending > 0) {
    summary += `, ${pending} queued`;
  }
  lines.push(summary);
  lines.push('');

  process.stderr.write(lines.join('\n') + '\n');
}

// ─── Main watch function ──────────────────────────────────────────────────────

/**
 * Start watching a directory for new .alog files.
 * Blocks until SIGINT (Ctrl+C), then prints a summary table and resolves.
 *
 * @param credentialContext  Authenticated Parchment client
 * @param userId    Authenticated user ID
 * @param directory Absolute or relative path to watch
 * @param opts      Watch options
 * @returns         The final WatchSession (all imports recorded)
 */
export async function startWatch(
  credentialContext: CredentialContext,
  userId: string,
  directory: string,
  opts: StartWatchOpts,
  runtime: StartWatchRuntime = {}
): Promise<WatchSession> {
  const accessFile = runtime.accessImpl ?? access;
  const readFileText = runtime.readFileImpl ?? readFile;
  const saveSession = runtime.saveWatchSessionImpl ?? saveWatchSession;
  if (!runtime.roastImporter) {
    throw new Error('startWatch requires a roastImporter to import roasts.');
  }
  const importRoast = runtime.roastImporter;
  const commitMode = opts.commitMode ?? 'batch';
  if (commitMode === 'batch' && !runtime.batchStore) {
    throw new Error('startWatch requires a batchStore in batch commit mode.');
  }
  // Individual commit mode names each roast's batch itself and never opens a session batch.
  const batchStore = commitMode === 'batch' ? runtime.batchStore : undefined;
  const watchDirectory = runtime.watchImpl ?? watch;
  const addSignalListener = runtime.addSignalListener ?? process.on.bind(process);
  const removeSignalListener = runtime.removeSignalListener ?? process.removeListener.bind(process);
  const addExitKeyListener = runtime.addExitKeyListener ?? addDefaultExitKeyListener;
  const debounceMs = runtime.debounceMs ?? 2000;
  const sessionTokenProvider =
    runtime.sessionTokenProvider ??
    (async () => {
      const {
        data: { session },
      } = await credentialContext.getSession();
      if (!session?.apiKey) {
        throw new AuthError('Session expired mid-watch. Run `purvey auth login` and retry.');
      }
      return session.apiKey;
    });
  const inventoryLister = runtime.inventoryLister ?? listInventory;

  // 1. Validate directory exists
  try {
    await accessFile(directory, constants.R_OK);
  } catch {
    throw new Error(`Directory not found or not readable: "${directory}"`);
  }

  // 2. Snapshot existing .alog files so we only react to NEW ones
  const readdirEntries = runtime.readdirImpl ?? (await import('fs/promises')).readdir;
  const existingFiles = new Set<string>();
  try {
    const entries = await readdirEntries(directory);
    for (const entry of entries) {
      if (isAlogFile(entry)) {
        existingFiles.add(entry);
      }
    }
  } catch {
    // Non-fatal — if readdir fails we just won't filter pre-existing files
  }

  // 3. Create session state
  const session: WatchSession = {
    directory,
    coffeeId: opts.coffeeId,
    coffeeName: opts.coffeeName,
    batchPrefix: opts.batchPrefix,
    promptEach: opts.promptEach ?? false,
    autoMatch: opts.autoMatch ?? false,
    interactiveRecovery: opts.interactiveRecovery ?? false,
    commitMode,
    ...(commitMode === 'batch' && opts.resumeBatchId !== undefined
      ? {
          batchId: opts.resumeBatchId,
          batchOpenedBySession: opts.resumeBatchOpenedBySession ?? false,
        }
      : {}),
    ...(opts.ozIn !== undefined ? { ozIn: opts.ozIn } : {}),
    ...(opts.roastNotes !== undefined ? { roastNotes: opts.roastNotes } : {}),
    ...(opts.roastTargets !== undefined ? { roastTargets: opts.roastTargets } : {}),
    startedAt: opts.startedAt ?? new Date().toISOString(),
    imports: opts.resumeImports
      ? normalizeResumedImports(opts.resumeImports, opts.batchPrefix, commitMode)
      : [],
  };

  // 4. Debounce map: filename → timeout handle
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  // Track in-progress files to avoid double-processing
  const processing = new Set<string>();
  const activeTasks = new Set<Promise<void>>();
  const queuedImports = new Map<string, QueuedImport>();
  let shuttingDown = false;
  // session.imports already includes resumed records, so numbering continues
  // across resume boundaries. Claimed up front so files detected close together
  // never share a position.
  let nextSequence = nextSequenceAfter(session.imports);

  for (const record of session.imports) {
    if (record.status === 'pending' && record.selectedCoffeeId && record.selectedCoffeeName) {
      queuedImports.set(record.fileName, {
        record,
        coffeeId: record.selectedCoffeeId,
        coffeeName: record.selectedCoffeeName,
      });
    }
  }

  // ── Session batch (batch commit mode) ──────────────────────────────────────
  // The batch is opened when the first roast is about to be saved, not when the
  // watch starts, so a session that sees no files leaves nothing behind.
  let sessionBatch: Promise<string> | null = null;

  /**
   * A session saved before batches had ids knows only the shared name. Its saved
   * roasts were grouped by that name and their roast date, so the session
   * continues in the batch that holds its first saved roast.
   */
  async function findBatchOfSavedRoasts(store: WatchBatchStore): Promise<string | undefined> {
    const saved = session.imports
      .filter(
        (record) =>
          record.status === 'success' &&
          record.roastId !== null &&
          record.batchName === opts.batchPrefix
      )
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    for (const record of saved) {
      const batchId = record.batchId ?? (await store.batchIdForRoast(record.roastId!));
      if (!batchId) continue;

      const batch = await store.get(batchId);
      if (!batch) continue;

      for (const other of saved) {
        if (batch.roastIds.includes(other.roastId!)) other.batchId = batch.id;
      }
      const elsewhere = saved.filter((other) => !batch.roastIds.includes(other.roastId!));
      if (elsewhere.length > 0) {
        process.stderr.write(
          `ℹ  ${elsewhere.length} roast${elsewhere.length !== 1 ? 's' : ''} saved earlier in this session ${elsewhere.length !== 1 ? 'are' : 'is'} in a different batch: ${elsewhere
            .map((other) => `#${other.roastId}`)
            .join(', ')}.\n` +
            `   Move one into this batch with: purvey roast update <roast-id> --batch-id ${batch.id}\n`
        );
      }
      return batch.id;
    }
    return undefined;
  }

  async function resolveSessionBatch(store: WatchBatchStore): Promise<string> {
    if (session.batchId !== undefined) {
      const existing = await store.get(session.batchId);
      if (existing) return existing.id;
      process.stderr.write(
        `⚠ Batch ${session.batchId} no longer exists. New roasts from this session go into a new batch.\n`
      );
      session.batchId = undefined;
      session.batchOpenedBySession = undefined;
    } else {
      const joined = await findBatchOfSavedRoasts(store);
      if (joined !== undefined) {
        session.batchId = joined;
        session.batchOpenedBySession = false;
        await saveSession(session);
        return joined;
      }
    }

    const opened = await store.create({
      name: opts.batchPrefix,
      batchDate: localDateIso(new Date(session.startedAt)),
    });
    session.batchId = opened.id;
    session.batchOpenedBySession = true;
    await saveSession(session);
    return opened.id;
  }

  function ensureSessionBatch(store: WatchBatchStore): Promise<string> {
    sessionBatch ??= resolveSessionBatch(store).catch((err: unknown) => {
      // Let the next roast try again instead of failing the rest of the session.
      sessionBatch = null;
      throw err;
    });
    return sessionBatch;
  }

  /**
   * Remove the session's batch when the session opened it and never saved a
   * roast into it, for example when every import failed. Deleting a batch also
   * deletes its roasts, so the batch is read back and removed only when empty.
   */
  async function removeUnusedSessionBatch(store: WatchBatchStore): Promise<void> {
    const batchId = session.batchId;
    if (batchId === undefined || !session.batchOpenedBySession) return;
    if (session.imports.some((r) => r.status === 'success' && r.batchId === batchId)) return;

    try {
      const batch = await store.get(batchId);
      if (batch && batch.roastIds.length > 0) return;
      if (batch) await store.delete(batchId);
      session.batchId = undefined;
      session.batchOpenedBySession = undefined;
      await saveSession(session);
      process.stderr.write(
        `🧹 Removed the empty batch "${opts.batchPrefix}" opened for this session; no roasts were saved into it.\n\n`
      );
    } catch (err) {
      process.stderr.write(
        `⚠ Could not remove the empty batch opened for this session: ${err instanceof Error ? err.message : String(err)}\n` +
          `   Remove it with: purvey roast-batch delete ${batchId}\n\n`
      );
    }
  }

  async function commitQueuedImport(queued: QueuedImport): Promise<void> {
    const { record, coffeeId, coffeeName } = queued;

    let fileContent = queued.fileContent;
    if (!fileContent) {
      const filePath = join(directory, record.fileName);
      try {
        await accessFile(filePath, constants.R_OK);
        fileContent = await readFileText(filePath, 'utf-8');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unreadable';
        record.status = 'failed';
        record.error = errMsg;
        record.importedAt = new Date().toISOString();
        queuedImports.delete(record.fileName);
        await saveSession(session);
        process.stderr.write(`✗ Failed to read ${record.fileName}: ${errMsg}\n`);
        return;
      }
    }

    try {
      const batchId = batchStore ? await ensureSessionBatch(batchStore) : undefined;
      const result = await importRoast({
        fileContent,
        fileName: record.fileName,
        coffeeId,
        batchName: record.batchName,
        ...(batchId !== undefined ? { batchId } : {}),
        ozIn: opts.ozIn,
        roastNotes: opts.roastNotes,
        roastTargets: opts.roastTargets,
      });

      const milestoneCount = Object.values(result.milestones).filter(
        (v) => v !== undefined && (v as number) > 0
      ).length;
      const tempCount = result.message.match(/(\d+) data points/)?.[1] ?? '?';

      record.roastId = result.roast_id;
      record.batchId = batchId ?? result.batch_id;
      record.status = 'success';
      record.error = undefined;
      record.milestones = result.milestones;
      record.phases = result.phases;
      record.importedAt = new Date().toISOString();
      record.selectedCoffeeId = coffeeId;
      record.selectedCoffeeName = coffeeName;
      queuedImports.delete(record.fileName);
      await saveSession(session);

      process.stderr.write(
        `✓ Imported: ${record.fileName} → Roast #${result.roast_id} (${tempCount} temps, ${milestoneCount} milestones)` +
          (coffeeName !== opts.coffeeName ? ` [${coffeeName}]` : '') +
          '\n'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      record.status = 'failed';
      record.error = errMsg;
      record.importedAt = new Date().toISOString();
      queuedImports.delete(record.fileName);
      await saveSession(session);
      process.stderr.write(`✗ Failed to import ${record.fileName}: ${errMsg}\n`);
    }
  }

  // processFile: read, import, record result
  async function processFile(filename: string): Promise<void> {
    if (processing.has(filename) || shuttingDown) return;
    processing.add(filename);

    const sequence = nextSequence++;
    const batchName = resolveWatchBatchName(opts.batchPrefix, sequence, commitMode);

    // If promptEach: let user override the bean selection
    let effectiveCoffeeId = opts.coffeeId;
    let effectiveCoffeeName = opts.coffeeName;
    if (opts.promptEach) {
      const { pickBean } = await import('./forms.js');
      process.stderr.write(`\nNew file detected: ${filename}\n`);
      // allowCancel keeps the watch session alive on Ctrl+C / Escape so the
      // shutdown path can still print the summary and commit queued imports.
      let bean: Awaited<ReturnType<typeof pickBean>>;
      try {
        bean = await pickBean(await sessionTokenProvider(), { allowCancel: true });
      } catch (err) {
        const reason = `Bean selection failed: ${err instanceof Error ? err.message : String(err)}`;
        const record: ImportRecord = {
          fileName: filename,
          roastId: null,
          batchName,
          sequence,
          status: 'needs-review',
          error: reason,
          importedAt: new Date().toISOString(),
        };
        session.imports.push(record);
        await saveSession(session);
        process.stderr.write(`⚠ Needs review: ${filename} — ${reason}\n`);
        processing.delete(filename);
        return;
      }
      if (!bean) {
        const record: ImportRecord = {
          fileName: filename,
          roastId: null,
          batchName,
          sequence,
          status: 'needs-review',
          error: 'Bean selection cancelled',
          importedAt: new Date().toISOString(),
        };
        session.imports.push(record);
        await saveSession(session);
        process.stderr.write(`⚠ Skipped ${filename} — bean selection cancelled.\n`);
        processing.delete(filename);
        return;
      }
      effectiveCoffeeId = bean.id;
      effectiveCoffeeName = bean.name;
    }

    const filePath = join(directory, filename);

    let fileContent: string;
    try {
      await accessFile(filePath, constants.R_OK);
      fileContent = await readFileText(filePath, 'utf-8');
    } catch (err) {
      const record: ImportRecord = {
        fileName: filename,
        roastId: null,
        batchName,
        sequence,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unreadable',
        importedAt: new Date().toISOString(),
      };
      session.imports.push(record);
      await saveSession(session);
      process.stderr.write(`✗ Failed to read ${filename}: ${record.error}\n`);
      processing.delete(filename);
      return;
    }

    // Auto-match mode: use AI to classify the bean
    let aiResult: Awaited<ReturnType<typeof runAutoMatch>> | undefined;
    if (opts.autoMatch && !opts.promptEach) {
      aiResult = await runAutoMatch(
        credentialContext,
        userId,
        filename,
        fileContent,
        inventoryLister,
        sessionTokenProvider
      );
      if (aiResult.skip) {
        // AI returned low confidence or failed — mark as needs-review
        const record: ImportRecord = {
          fileName: filename,
          roastId: null,
          batchName,
          sequence,
          status: 'needs-review',
          error: aiResult.reason,
          importedAt: new Date().toISOString(),
          ...(aiResult.aiMatch !== undefined ? { aiMatch: aiResult.aiMatch } : {}),
        };
        session.imports.push(record);
        await saveSession(session);
        const confStr =
          aiResult.aiMatch !== undefined ? ` (confidence: ${aiResult.aiMatch.confidence}%)` : '';
        process.stderr.write(`⚠ Needs review: ${filename}${confStr} — ${aiResult.reason}\n`);
        processing.delete(filename);
        return;
      }
      effectiveCoffeeId = aiResult.coffeeId!;
      effectiveCoffeeName = aiResult.coffeeName!;
      process.stderr.write(
        `${aiResult.matchMethod === 'inventory' ? '✓ Inventory matched' : '🤖 AI matched'}: ${filename} → ${effectiveCoffeeName} (${aiResult.aiMatch!.confidence}% confidence)\n` +
          `   Reasoning: ${aiResult.aiMatch!.reasoning}\n`
      );
    }

    const aiMatchField: ImportRecord['aiMatch'] | undefined =
      opts.autoMatch && !opts.promptEach && aiResult?.aiMatch ? aiResult.aiMatch : undefined;

    const record: ImportRecord = {
      fileName: filename,
      roastId: null,
      batchName,
      sequence,
      status: 'pending',
      importedAt: new Date().toISOString(),
      selectedCoffeeId: effectiveCoffeeId,
      selectedCoffeeName: effectiveCoffeeName,
      ...(aiMatchField !== undefined ? { aiMatch: aiMatchField } : {}),
      ...(aiResult?.matchMethod !== undefined ? { matchMethod: aiResult.matchMethod } : {}),
    };
    session.imports.push(record);

    const queued: QueuedImport = {
      record,
      coffeeId: effectiveCoffeeId,
      coffeeName: effectiveCoffeeName,
      fileContent,
    };

    try {
      if (commitMode === 'batch') {
        queuedImports.set(filename, queued);
        await saveSession(session);
        process.stderr.write(
          `… Queued: ${filename} → ${batchName} (roast ${sequence})` +
            (effectiveCoffeeName !== opts.coffeeName ? ` [${effectiveCoffeeName}]` : '') +
            '\n'
        );
        return;
      }

      await commitQueuedImport(queued);
    } finally {
      processing.delete(filename);
    }
  }

  // debounced handler
  function onFileEvent(filename: string): void {
    if (!isAlogFile(filename) || shuttingDown) return;
    // Skip files that were present when we started
    if (existingFiles.has(filename)) return;

    if (debounceTimers.has(filename)) {
      clearTimeout(debounceTimers.get(filename)!);
    }
    debounceTimers.set(
      filename,
      setTimeout(() => {
        debounceTimers.delete(filename);
        const task = processFile(filename)
          .catch((err: unknown) => {
            process.stderr.write(
              `✗ Unexpected error processing ${filename}: ${err instanceof Error ? err.message : String(err)}\n`
            );
          })
          .finally(() => {
            activeTasks.delete(task);
          });
        activeTasks.add(task);
      }, debounceMs)
    );
  }

  // 5. Start fs.watch
  let watcher: FSWatcher;
  try {
    watcher = watchDirectory(directory, { persistent: true }, (_eventType, filename) => {
      if (filename) onFileEvent(filename);
    });
  } catch (err) {
    throw new Error(
      `Failed to watch directory "${directory}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const modeLabel = opts.autoMatch
    ? 'auto-match mode'
    : opts.promptEach
      ? 'prompt-each mode'
      : `coffee: ${opts.coffeeName}`;
  const namingLabel =
    commitMode === 'batch'
      ? `batch: "${opts.batchPrefix}"${session.batchId !== undefined ? `, batch ID ${session.batchId}` : ''}`
      : `batch names: "${generateBatchName(opts.batchPrefix, 1)}", "${generateBatchName(opts.batchPrefix, 2)}", …`;
  process.stderr.write(
    `👁  Watching ${directory} for new .alog files (${modeLabel}, ${commitMode} commit mode, ${namingLabel})...\n`
  );
  process.stderr.write(`    Press Ctrl+C to stop and view summary.\n\n`);

  // 6. Block until SIGINT, then cleanup and return
  await new Promise<void>((resolve, reject) => {
    let shutdownPromise: Promise<void> | null = null;
    let repeatedSignalNoticePrinted = false;

    let cleanupExitKeyListener: (() => void) | null = null;

    const cleanupSignalHandlers = (): void => {
      removeSignalListener('SIGINT', onSigint);
      removeSignalListener('SIGTERM', onSigterm);
      cleanupExitKeyListener?.();
      cleanupExitKeyListener = null;
    };

    const printRepeatedSignalNotice = (signal: 'SIGINT' | 'SIGTERM'): void => {
      if (repeatedSignalNoticePrinted) return;
      repeatedSignalNoticePrinted = true;
      process.stderr.write(
        `⏳ Shutdown already in progress (${signal}). Waiting for active imports and queued roasts to finish...\n`
      );
    };

    const shutdown = (signal: 'SIGINT' | 'SIGTERM'): Promise<void> => {
      if (shutdownPromise) {
        printRepeatedSignalNotice(signal);
        return shutdownPromise;
      }

      shuttingDown = true;
      shutdownPromise = (async () => {
        // Cancel all pending debounce timers
        for (const timer of debounceTimers.values()) {
          clearTimeout(timer);
        }
        debounceTimers.clear();

        watcher.close();

        try {
          await Promise.allSettled([...activeTasks]);

          process.stderr.write('\n');
          printVerificationTable(session, opts.autoMatch);

          if (commitMode === 'batch' && queuedImports.size > 0) {
            process.stderr.write(
              `🗂  Committing ${queuedImports.size} queued roast${queuedImports.size !== 1 ? 's' : ''}...\n`
            );
            for (const queued of [...queuedImports.values()]) {
              await commitQueuedImport(queued);
            }
            process.stderr.write('\n');
            printVerificationTable(session, opts.autoMatch);
          }

          let needsReview = session.imports.filter((r) => r.status === 'needs-review');
          if (opts.interactiveRecovery && needsReview.length > 0) {
            const { pickBean } = await import('./forms.js');
            process.stderr.write(
              `🔎 Assign ${needsReview.length} unmatched roast${needsReview.length !== 1 ? 's' : ''} from stocked inventory:\n`
            );
            for (const record of needsReview) {
              process.stderr.write(`\n${record.fileName}\n`);
              try {
                const bean = await pickBean(await sessionTokenProvider(), { allowCancel: true });
                if (!bean) continue;
                record.status = 'pending';
                record.error = undefined;
                record.selectedCoffeeId = bean.id;
                record.selectedCoffeeName = bean.name;
                await saveSession(session);
                await commitQueuedImport({
                  record,
                  coffeeId: bean.id,
                  coffeeName: bean.name,
                });
              } catch (err) {
                record.error = `Bean selection failed: ${err instanceof Error ? err.message : String(err)}`;
                await saveSession(session);
                process.stderr.write(`⚠ ${record.fileName}: ${record.error}\n`);
              }
            }
            process.stderr.write('\n');
            printVerificationTable(session, opts.autoMatch);
            needsReview = session.imports.filter((r) => r.status === 'needs-review');
          }

          if (batchStore) await removeUnusedSessionBatch(batchStore);

          // Keep the command fallback for flag mode and cancelled form recovery.
          if (needsReview.length > 0) {
            process.stderr.write(
              `⚠  ${needsReview.length} file${needsReview.length !== 1 ? 's need' : ' needs'} manual bean assignment:\n`
            );
            for (const rec of needsReview) {
              process.stderr.write(`   - ${rec.fileName}\n`);
            }
            process.stderr.write(
              `   Use \`${buildManualImportRecoveryCommand({
                batchId: session.batchId,
                ozIn: opts.ozIn,
                roastNotes: opts.roastNotes,
                roastTargets: opts.roastTargets,
              })}\` to import them manually.\n\n`
            );
          }

          resolve();
        } catch (error) {
          reject(error);
        } finally {
          cleanupSignalHandlers();
        }
      })();

      return shutdownPromise;
    };

    const onSigint = (): void => {
      void shutdown('SIGINT');
    };
    const onSigterm = (): void => {
      void shutdown('SIGTERM');
    };

    addSignalListener('SIGINT', onSigint);
    addSignalListener('SIGTERM', onSigterm);
    cleanupExitKeyListener = addExitKeyListener(onSigint);
  });

  return session;
}

// ─── Auto-match helpers ───────────────────────────────────────────────────────

interface AutoMatchResult {
  skip: boolean;
  reason?: string;
  coffeeId?: number;
  coffeeName?: string;
  aiMatch?: {
    coffeeName: string;
    confidence: number;
    reasoning: string;
  };
  matchMethod?: 'inventory' | 'ai';
}

const SUPPLIER_STOP_WORDS = new Set([
  'coffee',
  'co',
  'company',
  'green',
  'import',
  'imports',
  'roaster',
  'roasters',
]);

const INVENTORY_PAGE_SIZE = 100;

function meaningfulTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !SUPPLIER_STOP_WORDS.has(token));
}

function uniqueSupplierMatch(
  filename: string,
  inventory: Array<{ id: number; coffee_name: string; supplier?: string }>
): { id: number; coffeeName: string; supplier: string } | undefined {
  const filenameTokens = new Set(meaningfulTokens(filename));
  const candidates = inventory.filter((item) => {
    if (!item.supplier) return false;
    const supplierTokens = meaningfulTokens(item.supplier);
    return supplierTokens.length > 0 && supplierTokens.every((token) => filenameTokens.has(token));
  });
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0]!;
  return {
    id: candidate.id,
    coffeeName: candidate.coffee_name,
    supplier: candidate.supplier!,
  };
}

/**
 * Run AI classification for a newly detected .alog file.
 * Returns skip=true if confidence < 50 or if the AI call fails.
 */
async function runAutoMatch(
  credentialContext: CredentialContext,
  userId: string,
  filename: string,
  fileContent: string,
  inventoryLister: typeof listInventory,
  sessionTokenProvider: () => Promise<string | undefined>
): Promise<AutoMatchResult> {
  // Fetch the user's stocked inventory
  let inventory: Array<{
    id: number;
    coffee_name: string;
    origin?: string;
    processing?: string;
    supplier?: string;
  }> = [];

  try {
    const token = await sessionTokenProvider();
    for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
      const rows = await inventoryLister(
        { stocked_only: true, limit: INVENTORY_PAGE_SIZE, offset },
        token
      );

      inventory.push(
        ...rows.map((row) => {
          const catalog = row.coffee_catalog;
          return {
            id: row.id,
            coffee_name: catalog?.name ?? `Bean #${row.id}`,
            origin: catalog?.country ?? undefined,
            processing: catalog?.processing ?? undefined,
            supplier: catalog?.source ?? undefined,
          };
        })
      );

      if (rows.length < INVENTORY_PAGE_SIZE) break;
    }
  } catch (err) {
    const reason = `Failed to fetch inventory: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`⚠ Auto-match skipped for ${filename}: ${reason}\n`);
    return { skip: true, reason };
  }

  if (inventory.length === 0) {
    return { skip: true, reason: 'No stocked inventory items found' };
  }

  const supplierMatch = uniqueSupplierMatch(filename, inventory);
  if (supplierMatch) {
    const reasoning = `Filename identifies supplier ${supplierMatch.supplier}, which has exactly one stocked coffee.`;
    return {
      skip: false,
      coffeeId: supplierMatch.id,
      coffeeName: supplierMatch.coffeeName,
      aiMatch: {
        coffeeName: supplierMatch.coffeeName,
        confidence: 100,
        reasoning,
      },
      matchMethod: 'inventory',
    };
  }

  // Call the AI classifier
  try {
    const { classifyRoast } = await import('../cherry.js');
    const result = await classifyRoast(credentialContext, {
      artisanSource: {
        fileName: filename,
        fileContent,
      },
      inventory,
    });

    if (!result.match) {
      return { skip: true, reason: 'AI returned no match' };
    }

    const { inventoryId, coffeeName, confidence, reasoning } = result.match;
    const aiMatch = { coffeeName, confidence, reasoning };

    if (confidence < 50) {
      return {
        skip: true,
        reason: `Low AI confidence (${confidence}%)`,
        aiMatch,
      };
    }

    // Verify the matched inventoryId is actually in our fetched inventory
    const matchedItem = inventory.find((item) => item.id === inventoryId);
    if (!matchedItem) {
      return {
        skip: true,
        reason: `AI matched unknown inventory ID ${inventoryId}`,
        aiMatch,
      };
    }

    return {
      skip: false,
      coffeeId: inventoryId,
      coffeeName,
      aiMatch,
      matchMethod: 'ai',
    };
  } catch (err) {
    const reason = `AI classification error: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`⚠ Auto-match failed for ${filename}: ${reason}\n`);
    return { skip: true, reason };
  }
}
