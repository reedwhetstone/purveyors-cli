import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import type { StoredCredentials } from '../types/index.js';

const CONFIG_DIR = join(homedir(), '.config', 'purvey');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

// Legacy path from v0.1.x (was ~/.config/prvrs/)
const LEGACY_CONFIG_DIR = join(homedir(), '.config', 'prvrs');
const LEGACY_CREDENTIALS_FILE = join(LEGACY_CONFIG_DIR, 'credentials.json');

/**
 * Ensure the config directory exists with secure permissions.
 */
export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Read stored credentials from disk. Returns null if not found.
 * Migrates legacy credentials from ~/.config/prvrs/ (v0.1.x) to ~/.config/purvey/ on first run.
 */
export async function readCredentials(): Promise<StoredCredentials | null> {
  try {
    await access(CREDENTIALS_FILE, constants.R_OK);
    const raw = await readFile(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    // Not found at new path — check legacy location and migrate if present
    try {
      await access(LEGACY_CREDENTIALS_FILE, constants.R_OK);
      const raw = await readFile(LEGACY_CREDENTIALS_FILE, 'utf-8');
      const creds = JSON.parse(raw) as StoredCredentials;
      // Migrate to new path
      await writeCredentials(creds);
      // Clean up old file (best-effort)
      const { unlink: unlinkSync } = await import('fs/promises');
      await unlinkSync(LEGACY_CREDENTIALS_FILE).catch(() => {});
      return creds;
    } catch {
      return null;
    }
  }
}

/**
 * Write credentials to disk with restrictive permissions (owner read-only).
 */
export async function writeCredentials(creds: StoredCredentials): Promise<void> {
  await ensureConfigDir();
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/**
 * Delete stored credentials (logout).
 */
export async function deleteCredentials(): Promise<void> {
  try {
    await unlink(CREDENTIALS_FILE);
  } catch {
    // Already gone — that's fine
  }
}

export { CONFIG_DIR, CREDENTIALS_FILE };
