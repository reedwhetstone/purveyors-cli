/**
 * Watch module for `purvey roast watch`.
 * CLI-only — not exported via package.json subpaths.
 *
 * Monitors a directory for new .alog files, imports them automatically,
 * and shows a verification table when the session ends (Ctrl+C).
 */

import { watch, type FSWatcher } from 'fs';
import { readFile, access, writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { constants } from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importRoastFromFile } from '../roast.js';
import type { MilestoneData, ProcessedRoastData } from '../artisan/types.js';
import { CONFIG_DIR } from '../config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchSession {
  directory: string;
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  startedAt: string;
  imports: ImportRecord[];
}

export interface ImportRecord {
  fileName: string;
  roastId: number;
  batchName: string;
  status: 'success' | 'failed';
  error?: string;
  milestones?: MilestoneData;
  phases?: ProcessedRoastData['phases'];
  importedAt: string;
}

interface StartWatchOpts {
  coffeeId: number;
  coffeeName: string;
  batchPrefix: string;
  promptEach?: boolean;
  startSequence?: number;
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
export function printVerificationTable(session: WatchSession): void {
  const imports = session.imports;

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
      const status = rec.status === 'success' ? '✓' : `✗ ${rec.error?.slice(0, 5) ?? 'Error'}`;
      lines.push(row(file, id, batch, status));
    }
  }

  lines.push(hline('└', '┴', '┘', '─'));

  const succeeded = imports.filter((r) => r.status === 'success').length;
  const failed = imports.filter((r) => r.status === 'failed').length;
  lines.push('');
  lines.push(
    `Session: ${imports.length} file${imports.length !== 1 ? 's' : ''} processed, ${succeeded} succeeded, ${failed} failed`
  );
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
  opts: StartWatchOpts
): Promise<WatchSession> {
  // 1. Validate directory exists
  try {
    await access(directory, constants.R_OK);
  } catch {
    throw new Error(`Directory not found or not readable: "${directory}"`);
  }

  // 2. Snapshot existing .alog files so we only react to NEW ones
  const { readdir } = await import('fs/promises');
  const existingFiles = new Set<string>();
  try {
    const entries = await readdir(directory);
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
    startedAt: new Date().toISOString(),
    imports: [],
  };

  const startSequence = opts.startSequence ?? 0;

  // 4. Debounce map: filename → timeout handle
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  // Track in-progress files to avoid double-processing
  const processing = new Set<string>();

  // processFile: read, import, record result
  async function processFile(filename: string): Promise<void> {
    if (processing.has(filename)) return;
    processing.add(filename);

    const filePath = join(directory, filename);
    const sequence = startSequence + session.imports.length + 1;
    const batchName = generateBatchName(opts.batchPrefix, sequence);

    // If promptEach: let user override the bean selection
    let effectiveCoffeeId = opts.coffeeId;
    let effectiveCoffeeName = opts.coffeeName;
    if (opts.promptEach) {
      const { pickBean, guardCancel } = await import('./forms.js');
      process.stderr.write(`\nNew file detected: ${filename}\n`);
      const bean = await pickBean(supabase, userId);
      guardCancel(bean);
      effectiveCoffeeId = bean.id;
      effectiveCoffeeName = bean.name;
    }

    let fileContent: string;
    try {
      await access(filePath, constants.R_OK);
      fileContent = await readFile(filePath, 'utf-8');
    } catch (err) {
      const record: ImportRecord = {
        fileName: filename,
        roastId: 0,
        batchName,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unreadable',
        importedAt: new Date().toISOString(),
      };
      session.imports.push(record);
      await saveWatchSession(session);
      process.stderr.write(`✗ Failed to read ${filename}: ${record.error}\n`);
      processing.delete(filename);
      return;
    }

    try {
      const result = await importRoastFromFile(supabase, userId, {
        fileContent,
        fileName: filename,
        coffeeId: effectiveCoffeeId,
        batchName,
      });

      const milestoneCount = Object.values(result.milestones).filter(
        (v) => v !== undefined && (v as number) > 0
      ).length;

      const record: ImportRecord = {
        fileName: filename,
        roastId: result.roast_id,
        batchName,
        status: 'success',
        milestones: result.milestones,
        phases: result.phases,
        importedAt: new Date().toISOString(),
      };
      session.imports.push(record);
      await saveWatchSession(session);

      const tempCount = result.message.match(/(\d+) data points/)?.[1] ?? '?';
      process.stderr.write(
        `✓ Imported: ${filename} → Roast #${result.roast_id} (${tempCount} temps, ${milestoneCount} milestones)` +
          (effectiveCoffeeName !== opts.coffeeName ? ` [${effectiveCoffeeName}]` : '') +
          '\n'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const record: ImportRecord = {
        fileName: filename,
        roastId: 0,
        batchName,
        status: 'failed',
        error: errMsg,
        importedAt: new Date().toISOString(),
      };
      session.imports.push(record);
      await saveWatchSession(session);
      process.stderr.write(`✗ Failed to import ${filename}: ${errMsg}\n`);
    } finally {
      processing.delete(filename);
    }
  }

  // debounced handler
  function onFileEvent(filename: string): void {
    if (!isAlogFile(filename)) return;
    // Skip files that were present when we started
    if (existingFiles.has(filename)) return;

    if (debounceTimers.has(filename)) {
      clearTimeout(debounceTimers.get(filename)!);
    }
    debounceTimers.set(
      filename,
      setTimeout(() => {
        debounceTimers.delete(filename);
        processFile(filename).catch((err: unknown) => {
          process.stderr.write(
            `✗ Unexpected error processing ${filename}: ${err instanceof Error ? err.message : String(err)}\n`
          );
        });
      }, 2000)
    );
  }

  // 5. Start fs.watch
  let watcher: FSWatcher;
  try {
    watcher = watch(directory, { persistent: true }, (_eventType, filename) => {
      if (filename) onFileEvent(filename);
    });
  } catch (err) {
    throw new Error(
      `Failed to watch directory "${directory}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  process.stderr.write(
    `👁  Watching ${directory} for new .alog files (coffee: ${opts.coffeeName}, prefix: "${opts.batchPrefix}")...\n`
  );
  process.stderr.write(`    Press Ctrl+C to stop and view summary.\n\n`);

  // 6. Block until SIGINT, then cleanup and return
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      // Cancel all pending debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      watcher.close();
      process.stderr.write('\n');
      printVerificationTable(session);
      resolve();
    });
  });

  return session;
}
