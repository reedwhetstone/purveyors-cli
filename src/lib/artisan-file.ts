import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ArtisanFileDownload } from '@purveyors/sdk';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { normalizePathInput } from './path-input.js';
import { parseReferenceProfileId } from './reference-profiles.js';
import { getRoastSchema } from './roast.js';

/** Where a downloaded Artisan file goes: a named file, or a folder that takes the file's own name. */
export interface ArtisanFileDestination {
  path: string;
  directory: boolean;
}

/** The receipt printed after a download: where the file is, its size, and its checksum. */
export interface SavedArtisanFile {
  fileName: string;
  path: string;
  bytes: number;
  sha256: string;
}

const FALLBACK_FILE_NAME = 'artisan-profile.alog';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

function alreadyExists(path: string): PrvrsError {
  return new PrvrsError(
    'INVALID_ARGUMENT',
    `The destination "${path}" already exists. Pass --force to overwrite it.`
  );
}

function missingFolder(path: string): PrvrsError {
  return new PrvrsError('INVALID_ARGUMENT', `The folder for "${path}" does not exist.`);
}

/** Keep only the last path segment of the download name, so it always lands in the chosen folder. */
function localFileName(downloadName: string): string {
  const name = (downloadName.split(/[\\/]/).pop() ?? '').trim();
  return name === '' || name === '.' || name === '..' ? FALLBACK_FILE_NAME : name;
}

/**
 * Resolve `--output` before any request is made. An existing folder (or no
 * `--output`, meaning the current folder) takes the download's own file name;
 * anything else is the file to write. An existing file without `force`, or a
 * file in a folder that does not exist, is refused here, so nothing is
 * downloaded that could not be saved.
 */
export async function resolveArtisanFileDestination(
  output: string | undefined,
  force = false
): Promise<ArtisanFileDestination> {
  if (output === undefined) return { path: process.cwd(), directory: true };

  const normalized = normalizePathInput(output);
  if (!normalized) {
    throw new PrvrsError('INVALID_ARGUMENT', 'The destination path cannot be blank.');
  }

  const path = resolve(normalized);
  const existing = await stat(path).catch(() => null);
  if (existing?.isDirectory()) return { path, directory: true };
  if (!existing && /[\\/]$/.test(normalized)) {
    throw new PrvrsError('INVALID_ARGUMENT', `The folder "${path}" does not exist.`);
  }
  if (existing && !force) throw alreadyExists(path);
  if (!existing && !(await stat(dirname(path)).catch(() => null))?.isDirectory()) {
    throw missingFolder(path);
  }
  return { path, directory: false };
}

/**
 * Write a downloaded Artisan file unchanged, then read it back and compare its
 * SHA-256 with the one sent with the download. A file that does not match is
 * removed. With `force`, the bytes are checked beside the destination first, so
 * a failed download never replaces the file already there.
 */
export async function saveArtisanFile(
  download: ArtisanFileDownload,
  destination: ArtisanFileDestination,
  force = false
): Promise<SavedArtisanFile> {
  if (!download.contentSha256) {
    throw new PrvrsError(
      'GENERAL_ERROR',
      'The download came without a SHA-256 checksum, so the file could not be verified. Nothing was written.'
    );
  }

  const fileName = localFileName(download.fileName);
  const path = destination.directory ? join(destination.path, fileName) : destination.path;
  const writePath = force ? `${path}.${randomUUID()}.part` : path;

  try {
    await writeFile(writePath, download.bytes, { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw alreadyExists(path);
    if (errorCode(error) === 'ENOENT') throw missingFolder(path);
    throw error;
  }

  try {
    const written = await readFile(writePath);
    const sha256 = createHash('sha256').update(written).digest('hex');
    if (sha256 !== download.contentSha256) {
      throw new PrvrsError(
        'GENERAL_ERROR',
        `The downloaded file does not match its SHA-256 checksum (expected ${download.contentSha256}, got ${sha256}). Nothing was kept at "${path}"; run the command again.`
      );
    }
    if (writePath !== path) await rename(writePath, path);
    return { fileName, path, bytes: written.byteLength, sha256 };
  } catch (error) {
    await unlink(writePath).catch(() => undefined);
    throw error;
  }
}

export interface ArtisanFileDownloadOptions {
  output?: string;
  force?: boolean;
}

/** Download the Artisan file one of the caller's roasts was imported from, exactly as stored. */
export async function downloadRoastArtisanFile(
  roastId: number,
  options: ArtisanFileDownloadOptions = {}
): Promise<SavedArtisanFile> {
  const { id } = getRoastSchema.parse({ id: roastId });
  const destination = await resolveArtisanFileDestination(options.output, options.force);
  const client = await createParchmentClient('member');
  const download = unwrapParchment(
    await client.roasts.downloadArtisanFile(String(id)),
    `Roast ${id} Artisan file`
  );
  return saveArtisanFile(download, destination, options.force);
}

/** Download the Artisan file one of the caller's saved references was created from, exactly as stored. */
export async function downloadReferenceProfileArtisanFile(
  profileId: string,
  options: ArtisanFileDownloadOptions = {}
): Promise<SavedArtisanFile> {
  const id = parseReferenceProfileId(profileId, 'profile id');
  const destination = await resolveArtisanFileDestination(options.output, options.force);
  const client = await createParchmentClient('member');
  const download = unwrapParchment(
    await client.referenceProfiles.downloadArtisanFile(id),
    'reference-profile artisan-file'
  );
  return saveArtisanFile(download, destination, options.force);
}
