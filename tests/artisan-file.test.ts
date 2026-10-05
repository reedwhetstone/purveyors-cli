import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadReferenceProfileArtisanFile,
  downloadRoastArtisanFile,
} from '../src/lib/artisan-file.js';
import { PrvrsError } from '../src/lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function parseJson(text: string) {
  return JSON.parse(text.replace(ANSI_PATTERN, '').replace(/\r/g, '').trim()) as Record<
    string,
    unknown
  >;
}

/**
 * A stored Artisan file that is not valid UTF-8: a lone 0xff, a NUL, a broken
 * two-byte sequence, a stray continuation byte, and CRLF. Decoding it as text
 * and writing it back would change it, so only a byte-for-byte write passes.
 */
const FILE_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xfe, 0x00]),
  Buffer.from("{'timex': [0.0, 1.5], 'title': '"),
  Buffer.from([0xc3, 0x28, 0x80]),
  Buffer.from("'}\r\n"),
]);
const FILE_SHA256 = createHash('sha256').update(FILE_BYTES).digest('hex');
const OTHER_SHA256 = createHash('sha256').update('a different file').digest('hex');

const roastId = 4529;
const profileId = '5ea1af6f-234c-43a9-9bf8-5678dd24f854';
const roastRoute = `GET /v1/roasts/${roastId}/artisan-file`;
const referenceRoute = `GET /v1/reference-profiles/${profileId}/artisan-file`;

interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  body: Buffer | object;
}

interface RecordedRequest {
  route: string;
  authorization?: string;
}

function reprDigest(hex: string): string {
  return `sha-256=:${Buffer.from(hex, 'hex').toString('base64')}:`;
}

/** The attachment the API sends: raw bytes, the download name, and the stored SHA-256. */
function fileResponse(
  fileName: string,
  options: { bytes?: Buffer; sha256?: string | null } = {}
): FakeResponse {
  const sha256 = options.sha256 === undefined ? FILE_SHA256 : options.sha256;
  return {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      ...(sha256 === null ? {} : { 'repr-digest': reprDigest(sha256) }),
    },
    body: options.bytes ?? FILE_BYTES,
  };
}

const apiError = (
  status: number,
  code: string,
  message: string,
  reason?: string
): FakeResponse => ({
  status,
  body: { error: { code, message, ...(reason ? { reason } : {}) } },
});

/**
 * A fake Parchment API keyed by `METHOD /path`. An unlisted route answers 500,
 * so a command that calls anything unexpected fails.
 */
let routes: Record<string, FakeResponse> = {};
let requests: RecordedRequest[] = [];
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const route = `${req.method} ${(req.url ?? '').split('?')[0]}`;
    requests.push({ route, authorization: req.headers.authorization });
    const response =
      routes[route] ?? apiError(500, 'unexpected_route', `Unexpected ${req.method} ${req.url}`);
    const body = Buffer.isBuffer(response.body)
      ? response.body
      : Buffer.from(JSON.stringify(response.body));
    res.writeHead(response.status, {
      'content-type': 'application/json',
      ...response.headers,
      'content-length': String(body.byteLength),
    });
    res.end(body);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

const savedEnv = { ...process.env };

beforeEach(() => {
  routes = {};
  requests = [];
  process.env.PARCHMENT_API_BASE_URL = baseUrl;
  process.env.PARCHMENT_API_KEY = 'pk_test_fake';
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

const tempDir = () => mkdtempSync(join(tmpdir(), 'purvey-artisan-file-'));

async function failure(run: Promise<unknown>): Promise<PrvrsError> {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(PrvrsError);
  return error as PrvrsError;
}

/** Async CLI run so the in-process fake API can answer while the CLI waits. */
function runCli(args: string[]) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-artisan-file-home-'));
  const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolveRun, rejectRun) => {
      const child = spawn(tsxBin, ['src/index.ts', ...args], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: home,
          PURVEYORS_API_KEY: '',
          PARCHMENT_API_KEY: 'pk_test_fake',
          PARCHMENT_API_BASE_URL: baseUrl,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('error', rejectRun);
      child.on('close', (status) => resolveRun({ status, stdout, stderr }));
    }
  );
}

describe('downloading a stored Artisan file', () => {
  it("writes a roast's file byte for byte into a folder, under the name the API sent", async () => {
    routes[roastRoute] = fileResponse('Guji ☕ 2026-09-30.alog');
    const dir = tempDir();

    const saved = await downloadRoastArtisanFile(roastId, { output: dir });

    expect(saved).toEqual({
      fileName: 'Guji ☕ 2026-09-30.alog',
      path: join(dir, 'Guji ☕ 2026-09-30.alog'),
      bytes: FILE_BYTES.byteLength,
      sha256: FILE_SHA256,
    });
    expect(readFileSync(saved.path).equals(FILE_BYTES)).toBe(true);
    expect(readdirSync(dir)).toEqual(['Guji ☕ 2026-09-30.alog']);
    expect(requests).toEqual([{ route: roastRoute, authorization: 'Bearer pk_test_fake' }]);
  });

  it("writes a reference's file byte for byte to the named file", async () => {
    routes[referenceRoute] = fileResponse('Ethiopia baseline.alog');
    const path = join(tempDir(), 'background.alog');

    const saved = await downloadReferenceProfileArtisanFile(profileId, { output: path });

    expect(saved).toEqual({
      fileName: 'Ethiopia baseline.alog',
      path,
      bytes: FILE_BYTES.byteLength,
      sha256: FILE_SHA256,
    });
    expect(readFileSync(path).equals(FILE_BYTES)).toBe(true);
    expect(requests.map((request) => request.route)).toEqual([referenceRoute]);
  });

  it('saves into the current folder under the API name when no output is given', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog');
    const dir = tempDir();
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    const saved = await downloadRoastArtisanFile(roastId);

    expect(saved.path).toBe(join(dir, 'roast-4529.alog'));
    expect(readFileSync(saved.path).equals(FILE_BYTES)).toBe(true);
  });

  it('keeps a download name with path segments inside the chosen folder', async () => {
    routes[roastRoute] = fileResponse('../../outside/evil.alog');
    const dir = tempDir();

    const saved = await downloadRoastArtisanFile(roastId, { output: dir });

    expect(saved.path).toBe(join(dir, 'evil.alog'));
    expect(readdirSync(dir)).toEqual(['evil.alog']);
  });
});

describe('checking the download against its SHA-256', () => {
  it('removes the file and fails when the bytes do not match the digest', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog', { sha256: OTHER_SHA256 });
    const dir = tempDir();

    const error = await failure(downloadRoastArtisanFile(roastId, { output: dir }));

    expect(error.code).toBe('GENERAL_ERROR');
    expect(error.message).toContain('does not match its SHA-256 checksum');
    expect(error.message).toContain(`expected ${OTHER_SHA256}, got ${FILE_SHA256}`);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves the existing file in place when a --force download fails the check', async () => {
    routes[referenceRoute] = fileResponse('baseline.alog', { sha256: OTHER_SHA256 });
    const dir = tempDir();
    const path = join(dir, 'baseline.alog');
    writeFileSync(path, 'the file already here');

    const error = await failure(
      downloadReferenceProfileArtisanFile(profileId, { output: path, force: true })
    );

    expect(error.code).toBe('GENERAL_ERROR');
    expect(readFileSync(path, 'utf8')).toBe('the file already here');
    expect(readdirSync(dir)).toEqual(['baseline.alog']);
  });

  it('writes nothing when the download carries no digest', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog', { sha256: null });
    const dir = tempDir();

    const error = await failure(downloadRoastArtisanFile(roastId, { output: dir }));

    expect(error.code).toBe('GENERAL_ERROR');
    expect(error.message).toContain('without a SHA-256 checksum');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('refusing to overwrite', () => {
  it('refuses an existing file before downloading anything', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog');
    const path = join(tempDir(), 'background.alog');
    writeFileSync(path, 'the file already here');

    const error = await failure(downloadRoastArtisanFile(roastId, { output: path }));

    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toBe(
      `The destination "${path}" already exists. Pass --force to overwrite it.`
    );
    expect(readFileSync(path, 'utf8')).toBe('the file already here');
    expect(requests).toEqual([]);
  });

  it('refuses when the API name is already taken in the chosen folder', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog');
    const dir = tempDir();
    const path = join(dir, 'roast-4529.alog');
    writeFileSync(path, 'the file already here');

    const error = await failure(downloadRoastArtisanFile(roastId, { output: dir }));

    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toBe(
      `The destination "${path}" already exists. Pass --force to overwrite it.`
    );
    expect(readFileSync(path, 'utf8')).toBe('the file already here');
    expect(readdirSync(dir)).toEqual(['roast-4529.alog']);
  });

  it('replaces the file with --force, in a folder or by name', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog');
    const dir = tempDir();
    const path = join(dir, 'roast-4529.alog');

    writeFileSync(path, 'the file already here');
    await downloadRoastArtisanFile(roastId, { output: dir, force: true });
    expect(readFileSync(path).equals(FILE_BYTES)).toBe(true);

    writeFileSync(path, 'the file already here');
    await downloadRoastArtisanFile(roastId, { output: path, force: true });
    expect(readFileSync(path).equals(FILE_BYTES)).toBe(true);
    expect(readdirSync(dir)).toEqual(['roast-4529.alog']);
  });

  it('rejects a blank path, a missing folder, and a malformed id without calling the API', async () => {
    const missing = join(tempDir(), 'not-here');

    expect((await failure(downloadRoastArtisanFile(roastId, { output: '  ' }))).message).toBe(
      'The destination path cannot be blank.'
    );
    expect(
      (await failure(downloadRoastArtisanFile(roastId, { output: `${missing}/` }))).message
    ).toBe(`The folder "${missing}" does not exist.`);
    expect(
      (await failure(downloadRoastArtisanFile(roastId, { output: join(missing, 'file.alog') })))
        .message
    ).toBe(`The folder for "${join(missing, 'file.alog')}" does not exist.`);
    await expect(downloadReferenceProfileArtisanFile('4529')).rejects.toThrow(
      'Invalid profile id: expected a UUID.'
    );
    await expect(downloadRoastArtisanFile(0)).rejects.toThrow();

    expect(requests).toEqual([]);
  });
});

describe('when there is no file to download', () => {
  const roastReasons = {
    no_artisan_import:
      'Roast #4529 was entered manually or logged live, so there is no Artisan file to download.',
    artisan_file_not_retained:
      'Roast #4529 was imported before Artisan files were kept, so only its curve is on record. Re-import its Artisan .alog onto the roast to keep a copy.',
    artisan_file_too_large:
      "Roast #4529's Artisan file is larger than the 10 MB download limit, so it cannot be downloaded.",
  };
  const referenceReasons = {
    generated_plan:
      "This reference is a planned profile Purveyors generated, so it has no original Artisan file. Use the planned profile's export to download it for Artisan.",
    chart_snapshot:
      'This reference is a chart snapshot of a roast and holds no Artisan file. Download the Artisan file from the roast itself.',
    reference_archived: 'This reference is archived. Restore it to download its Artisan file.',
    artisan_file_not_retained:
      'This reference has no Artisan file on record. Upload the .alog again as a new reference to keep a copy.',
    artisan_file_too_large:
      "This reference's Artisan file is larger than the 10 MB download limit, so it cannot be downloaded.",
  };

  it.each(Object.entries(roastReasons))(
    'relays the roast reason %s unchanged and writes nothing',
    async (reason, message) => {
      routes[roastRoute] = apiError(400, 'roast_artisan_source_unavailable', message, reason);
      const dir = tempDir();

      const error = await failure(downloadRoastArtisanFile(roastId, { output: dir }));

      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toBe(message);
      expect(error.details).toEqual({
        error: { code: 'roast_artisan_source_unavailable', message, reason },
      });
      expect(readdirSync(dir)).toEqual([]);
    }
  );

  it.each(Object.entries(referenceReasons))(
    'relays the reference reason %s unchanged and writes nothing',
    async (reason, message) => {
      routes[referenceRoute] = apiError(400, 'reference_artisan_file_unavailable', message, reason);
      const dir = tempDir();

      const error = await failure(downloadReferenceProfileArtisanFile(profileId, { output: dir }));

      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toBe(message);
      expect(error.details).toEqual({
        error: { code: 'reference_artisan_file_unavailable', message, reason },
      });
      expect(readdirSync(dir)).toEqual([]);
    }
  );

  it('maps a missing roast, a missing Studio plan, and a failed stored-file check', async () => {
    const dir = tempDir();

    routes[roastRoute] = apiError(404, 'not_found', 'Roast not found');
    expect(await failure(downloadRoastArtisanFile(roastId, { output: dir }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Roast not found',
    });

    routes[roastRoute] = apiError(403, 'entitlement_required', 'Mallard Studio is required');
    expect(await failure(downloadRoastArtisanFile(roastId, { output: dir }))).toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Mallard Studio is required',
    });

    routes[roastRoute] = apiError(
      500,
      'artisan_file_integrity_failed',
      'The stored Artisan file no longer matches its recorded digest.'
    );
    expect(await failure(downloadRoastArtisanFile(roastId, { output: dir }))).toMatchObject({
      code: 'GENERAL_ERROR',
      message: 'The stored Artisan file no longer matches its recorded digest.',
    });

    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('purvey roast artisan-file and reference-profile artisan-file', () => {
  it('prints a JSON receipt with path, bytes, and sha256 for a roast', async () => {
    routes[roastRoute] = fileResponse('Guji 2026-09-30.alog');
    const dir = tempDir();

    const result = await runCli(['roast', 'artisan-file', String(roastId), '--output', dir]);

    expect(result.status).toBe(0);
    const path = join(dir, 'Guji 2026-09-30.alog');
    expect(parseJson(result.stdout)).toEqual({
      data: {
        roastId,
        fileName: 'Guji 2026-09-30.alog',
        path,
        bytes: FILE_BYTES.byteLength,
        sha256: FILE_SHA256,
      },
    });
    expect(readFileSync(path).equals(FILE_BYTES)).toBe(true);
  }, 30000);

  it('prints the same receipt for a reference, and refuses to overwrite it without --force', async () => {
    routes[referenceRoute] = fileResponse('Ethiopia baseline.alog');
    const path = join(tempDir(), 'background.alog');
    const args = ['reference-profile', 'artisan-file', profileId, '--output', path, '--json'];

    const first = await runCli(args);
    expect(first.status).toBe(0);
    expect(parseJson(first.stdout)).toEqual({
      data: {
        profileId,
        fileName: 'Ethiopia baseline.alog',
        path,
        bytes: FILE_BYTES.byteLength,
        sha256: FILE_SHA256,
      },
    });

    const second = await runCli(args);
    expect(second.status).toBe(2);
    expect(second.stdout).toBe('');
    expect(parseJson(second.stderr)).toMatchObject({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
      message: `The destination "${path}" already exists. Pass --force to overwrite it.`,
    });

    const forced = await runCli([...args, '--force']);
    expect(forced.status).toBe(0);
    expect(readFileSync(path).equals(FILE_BYTES)).toBe(true);
    expect(requests.map((request) => request.route)).toEqual([referenceRoute, referenceRoute]);
  }, 60000);

  it('exits 1 and leaves no file when the download fails its SHA-256 check', async () => {
    routes[roastRoute] = fileResponse('roast-4529.alog', { sha256: OTHER_SHA256 });
    const dir = tempDir();

    const result = await runCli(['roast', 'artisan-file', String(roastId), '--output', dir]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(parseJson(result.stderr)).toMatchObject({ code: 'GENERAL_ERROR', exitCode: 1 });
    expect(readdirSync(dir)).toEqual([]);
  }, 30000);

  it("exits 2 with Parchment's reason as the message when a roast has no file", async () => {
    const message =
      'Roast #4529 was imported before Artisan files were kept, so only its curve is on record. Re-import its Artisan .alog onto the roast to keep a copy.';
    routes[roastRoute] = apiError(
      400,
      'roast_artisan_source_unavailable',
      message,
      'artisan_file_not_retained'
    );
    const dir = tempDir();

    const result = await runCli(['roast', 'artisan-file', String(roastId), '--output', dir]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(parseJson(result.stderr)).toEqual({
      error: true,
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
      message,
    });
    expect(readdirSync(dir)).toEqual([]);
  }, 30000);

  it('rejects a malformed id with exit 2 before calling the API', async () => {
    const roast = await runCli(['roast', 'artisan-file', 'abc']);
    const reference = await runCli(['reference-profile', 'artisan-file', '4529']);

    expect(roast.status).toBe(2);
    expect(reference.status).toBe(2);
    expect(requests).toEqual([]);
  }, 60000);
});

describe('the Artisan file flag in list and get output', () => {
  const roast = (id: number, available: boolean) => ({
    roast_id: id,
    batch_name: 'Ethiopia Guji',
    artisan_file_available: available,
  });

  it('roast list and roast get show artisan_file_available as the API sent it', async () => {
    routes['GET /v1/roasts'] = {
      status: 200,
      body: { data: [roast(4529, true), roast(4470, false)], meta: { resource: 'roasts' } },
    };
    routes['GET /v1/roasts/4529'] = {
      status: 200,
      body: { data: roast(4529, true), meta: { resource: 'roasts' } },
    };

    const listed = await runCli(['roast', 'list', '--json']);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual([roast(4529, true), roast(4470, false)]);

    const fetched = await runCli(['roast', 'get', '4529', '--json']);
    expect(fetched.status).toBe(0);
    expect(JSON.parse(fetched.stdout)).toEqual(roast(4529, true));
  }, 60000);

  it('reference-profile list shows artisanFileAvailable as the API sent it', async () => {
    const body = {
      data: [
        { id: profileId, title: 'Ethiopia baseline', artisanFileAvailable: true },
        {
          id: '0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90',
          title: 'Later development',
          artisanFileAvailable: false,
        },
      ],
      meta: { resource: 'reference-profiles' },
    };
    routes['GET /v1/reference-profiles'] = { status: 200, body };

    const listed = await runCli(['reference-profile', 'list', '--json']);

    expect(listed.status).toBe(0);
    expect(parseJson(listed.stdout)).toEqual(body);
  }, 30000);
});
