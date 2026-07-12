import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile, unlink, access } from 'fs/promises';
import { constants } from 'fs';
import type { StoredCredentials } from '../types/index.js';
import { ConfigError } from './errors.js';

const CONFIG_DIR = join(homedir(), '.config', 'purvey');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Legacy path from v0.1.x (was ~/.config/prvrs/)
const LEGACY_CONFIG_DIR = join(homedir(), '.config', 'prvrs');
const LEGACY_CREDENTIALS_FILE = join(LEGACY_CONFIG_DIR, 'credentials.json');

// ─── App config types ────────────────────────────────────────────────────────

export interface PurveyConfig {
  'form-mode'?: boolean;
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.apiKey === 'string' &&
    typeof record.keyId === 'string' &&
    typeof record.createdAt === 'string' &&
    !!record.user &&
    typeof record.user === 'object'
  );
}

/** All valid config keys and their accepted value types. */
const CONFIG_KEYS = ['form-mode'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isValidConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

// ─── Credentials ─────────────────────────────────────────────────────────────

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
    const parsed = JSON.parse(raw) as unknown;
    if (isStoredCredentials(parsed)) return parsed;
    // Purge pre-0.30 renewable access/refresh-token credentials rather than
    // leaving them indefinitely on disk after the API-key custody cutover.
    await unlink(CREDENTIALS_FILE).catch(() => {});
    return null;
  } catch {
    // Not found at new path — check legacy location and migrate if present
    try {
      await access(LEGACY_CREDENTIALS_FILE, constants.R_OK);
      const raw = await readFile(LEGACY_CREDENTIALS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isStoredCredentials(parsed)) {
        await unlink(LEGACY_CREDENTIALS_FILE).catch(() => {});
        return null;
      }
      const creds = parsed;
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

// ─── App config read/write ────────────────────────────────────────────────────

/**
 * Read the purvey app config from ~/.config/purvey/config.json.
 * Returns an empty config object if the file does not exist.
 */
export async function readConfig(): Promise<PurveyConfig> {
  try {
    await access(CONFIG_FILE, constants.R_OK);
  } catch {
    return {};
  }

  try {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as PurveyConfig;
  } catch (error) {
    throw new ConfigError(`Config file is invalid or unreadable: ${CONFIG_FILE}.`, error);
  }
}

/**
 * Write the purvey app config to ~/.config/purvey/config.json.
 */
export async function writeConfig(config: PurveyConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Get a single config value by key.
 * Returns undefined if the key is not set.
 */
export async function getConfigValue(key: string): Promise<string | undefined> {
  if (!isValidConfigKey(key)) return undefined;
  const config = await readConfig();
  const value = config[key as ConfigKey];
  if (value === undefined) return undefined;
  return String(value);
}

/**
 * Set a single config value by key.
 * Throws if the key is invalid or the value cannot be coerced to the expected type.
 */
export async function setConfigValue(key: string, value: string): Promise<void> {
  if (!isValidConfigKey(key)) {
    throw new Error(`Unknown config key: "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}.`);
  }

  const config = await readConfig();

  if (key === 'form-mode') {
    if (value !== 'true' && value !== 'false') {
      throw new Error(`"form-mode" must be "true" or "false".`);
    }
    config['form-mode'] = value === 'true';
  }

  await writeConfig(config);
}

export { CONFIG_DIR, CREDENTIALS_FILE };
