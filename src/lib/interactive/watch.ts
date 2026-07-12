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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportRoastResult } from '../roast.js';
import type { MilestoneData, ProcessedRoastData } from '../artisan/types.js';
import { CONFIG_DIR } from '../config.js';
import { listInventory } from '../inventory.js';
import { AuthError } from '../errors.js';

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchSession {
  directory: string;
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  promptEach?: boolean;
  autoMatch?: boolean;
  commitMode?: 'batch' | 'individual';
  ozIn?: number;
  roastNotes?: string;
  roastTargets?: string;
  startedAt: string;
  imports: ImportRecord[];
}

export interface ImportRecord {
  fileName: string;
  roastId: number | null;
  batchName: string;
  status: 'pending' | 'success' | 'failed' | 'needs-review';
  error?: string;
  milestones?: MilestoneData;
  phases?: ProcessedRoastData['phases'];
  importedAt: string;
  selectedCoffeeId?: number;
  selectedCoffeeName?: string;
  // AI matching fields
  aiMatch?: {
    coffeeName: string;
    confidence: number;
    reasoning: string;
  };
}

interface StartWatchOpts {
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  commitMode?: 'batch' | 'individual';
  startedAt?: string;
  resumeImports?: ImportRecord[];
  promptEach?: boolean;
  autoMatch?: boolean;
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
}

function printVerificationTableStandard(imports: ImportRecord[]): void {
  // Column widths
  const COL_FILE = 31;
  const COL_ID = 10;
  const COL_BATCH = 26;
  const COL_STATUS = 9;

  function row(file: string, id: string, batch: string, status: string): string {
    return (
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
  lines.push(row('File', 'Roast ID', 'Batch', 'Status'));
  lines.push(hline('├', '┼', '┤', '─'));

  if (imports.length === 0) {
    lines.push(row('(no files imported)', '', '', ''));
  } else {
    for (const rec of imports) {
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
      lines.push(row(file, id, batch, status));
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
  const COL_FILE = 29;
  const COL_ID = 9;
  const COL_BEAN = 22;
  const COL_CONF = 10;
  const COL_STATUS = 7;

  function row(file: string, id: string, bean: string, conf: string, status: string): string {
    return (
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
  lines.push(row('File', 'Roast ID', 'Matched Bean', 'Confidence', 'Status'));
  lines.push(hline('├', '┼', '┤', '─'));

  if (imports.length === 0) {
    lines.push(row('(no files imported)', '', '', '', ''));
  } else {
    for (const rec of imports) {
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
      lines.push(row(file, id, bean, conf, status));
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
 * @param supabase  Authenticated Supabase client
 * @param userId    Authenticated user ID
 * @param directory Absolute or relative path to watch
 * @param opts      Watch options
 * @returns         The final WatchSession (all imports recorded)
 */
export async function startWatch(
  supabase: SupabaseClient,
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
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new AuthError('Session expired mid-watch. Run `purvey auth login` and retry.');
      }
      return session.access_token;
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

  const commitMode = opts.commitMode ?? 'batch';

  // 3. Create session state
  const session: WatchSession = {
    directory,
    coffeeId: opts.coffeeId,
    coffeeName: opts.coffeeName,
    batchPrefix: opts.batchPrefix,
    promptEach: opts.promptEach ?? false,
    autoMatch: opts.autoMatch ?? false,
    commitMode,
    ...(opts.ozIn !== undefined ? { ozIn: opts.ozIn } : {}),
    ...(opts.roastNotes !== undefined ? { roastNotes: opts.roastNotes } : {}),
    ...(opts.roastTargets !== undefined ? { roastTargets: opts.roastTargets } : {}),
    startedAt: opts.startedAt ?? new Date().toISOString(),
    imports: opts.resumeImports ? [...opts.resumeImports] : [],
  };

  // 4. Debounce map: filename → timeout handle
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  // Track in-progress files to avoid double-processing
  const processing = new Set<string>();
  const activeTasks = new Set<Promise<void>>();
  const queuedImports = new Map<string, QueuedImport>();
  let shuttingDown = false;

  for (const record of session.imports) {
    if (record.status === 'pending' && record.selectedCoffeeId && record.selectedCoffeeName) {
      queuedImports.set(record.fileName, {
        record,
        coffeeId: record.selectedCoffeeId,
        coffeeName: record.selectedCoffeeName,
      });
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
      const result = await importRoast({
        fileContent,
        fileName: record.fileName,
        coffeeId,
        batchName: record.batchName,
        ozIn: opts.ozIn,
        roastNotes: opts.roastNotes,
        roastTargets: opts.roastTargets,
      });

      const milestoneCount = Object.values(result.milestones).filter(
        (v) => v !== undefined && (v as number) > 0
      ).length;
      const tempCount = result.message.match(/(\d+) data points/)?.[1] ?? '?';

      record.roastId = result.roast_id;
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

    // session.imports already includes resumed records, so length alone yields
    // the next sequential batch number across resume boundaries.
    const sequence = session.imports.length + 1;
    const batchName = generateBatchName(opts.batchPrefix, sequence);

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
        supabase,
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
        `🤖 AI matched: ${filename} → ${effectiveCoffeeName} (${aiResult.aiMatch!.confidence}% confidence)\n` +
          `   Reasoning: ${aiResult.aiMatch!.reasoning}\n`
      );
    }

    const aiMatchField: ImportRecord['aiMatch'] | undefined =
      opts.autoMatch && !opts.promptEach && aiResult?.aiMatch ? aiResult.aiMatch : undefined;

    const record: ImportRecord = {
      fileName: filename,
      roastId: null,
      batchName,
      status: 'pending',
      importedAt: new Date().toISOString(),
      selectedCoffeeId: effectiveCoffeeId,
      selectedCoffeeName: effectiveCoffeeName,
      ...(aiMatchField !== undefined ? { aiMatch: aiMatchField } : {}),
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
          `… Queued: ${filename} → ${batchName}` +
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
  process.stderr.write(
    `👁  Watching ${directory} for new .alog files (${modeLabel}, ${commitMode} commit mode, prefix: "${opts.batchPrefix}")...\n`
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

          // Point at manual recovery for any files left needing review
          // (auto-match low confidence, or cancelled prompt-each selections)
          const needsReview = session.imports.filter((r) => r.status === 'needs-review');
          if (needsReview.length > 0) {
            process.stderr.write(
              `⚠  ${needsReview.length} file${needsReview.length !== 1 ? 's need' : ' needs'} manual bean assignment:\n`
            );
            for (const rec of needsReview) {
              process.stderr.write(`   - ${rec.fileName}\n`);
            }
            process.stderr.write(
              `   Use \`${buildManualImportRecoveryCommand({
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
}

/**
 * Run AI classification for a newly detected .alog file.
 * Returns skip=true if confidence < 50 or if the AI call fails.
 */
async function runAutoMatch(
  supabase: SupabaseClient,
  userId: string,
  filename: string,
  fileContent: string,
  inventoryLister: typeof listInventory,
  sessionTokenProvider: () => Promise<string | undefined>
): Promise<AutoMatchResult> {
  // Parse alog metadata without full import
  let alogMetadata: {
    title: string;
    roastertype?: string;
    beans?: string;
    roastingnotes?: string;
    weight?: [number, number, string];
  };

  try {
    const { processAlogFile } = await import('../artisan/parser.js');
    const parsed = processAlogFile(fileContent) as Record<string, unknown>;
    alogMetadata = {
      title: typeof parsed.title === 'string' ? parsed.title : filename,
      roastertype: typeof parsed.roastertype === 'string' ? parsed.roastertype : undefined,
      beans: typeof parsed.beans === 'string' ? parsed.beans : undefined,
      roastingnotes: typeof parsed.roastingnotes === 'string' ? parsed.roastingnotes : undefined,
      weight: Array.isArray(parsed.weight)
        ? (parsed.weight as [number, number, string])
        : undefined,
    };
  } catch {
    // If we can't parse the file, fall back to filename as title
    alogMetadata = { title: filename };
  }

  // Fetch the user's stocked inventory
  let inventory: Array<{
    id: number;
    coffee_name: string;
    origin?: string;
    processing?: string;
  }> = [];

  try {
    const rows = await inventoryLister(
      { stocked_only: true, limit: 100 },
      await sessionTokenProvider()
    );

    inventory = rows.map((row) => {
      const catalog = row.coffee_catalog;
      return {
        id: row.id,
        coffee_name: catalog?.name ?? `Bean #${row.id}`,
        origin: catalog?.country ?? undefined,
        processing: catalog?.processing ?? undefined,
      };
    });
  } catch (err) {
    const reason = `Failed to fetch inventory: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`⚠ Auto-match skipped for ${filename}: ${reason}\n`);
    return { skip: true, reason };
  }

  if (inventory.length === 0) {
    return { skip: true, reason: 'No stocked inventory items found' };
  }

  // Call the AI classifier
  try {
    const { classifyRoast } = await import('../ai.js');
    // Always include the filename — it often contains the bean name
    // even when the .alog XML title is generic (e.g. "Roaster Scope")
    const enrichedMetadata = {
      ...alogMetadata,
      filename,
    };
    const result = await classifyRoast(supabase, { alogMetadata: enrichedMetadata, inventory });

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
    };
  } catch (err) {
    const reason = `AI classification error: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`⚠ Auto-match failed for ${filename}: ${reason}\n`);
    return { skip: true, reason };
  }
}
