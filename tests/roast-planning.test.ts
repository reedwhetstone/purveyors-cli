import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface RecordedRequest {
  method: string;
  url: string;
  authorization?: string;
  idempotencyKey?: string;
  body?: unknown;
}

interface FakeResponse {
  status: number;
  body: unknown;
}

type FakeRoutes = Record<string, FakeResponse>;

/**
 * A fake Parchment API keyed by `METHOD /path` (query string excluded). An
 * unlisted route answers 500, so a command that calls anything unexpected fails.
 */
async function withFakeApi(
  routes: FakeRoutes,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk) => (raw += String(chunk)));
    req.on('end', () => {
      const url = req.url ?? '';
      const header = req.headers['idempotency-key'];
      requests.push({
        method: req.method ?? '',
        url,
        authorization: req.headers.authorization,
        idempotencyKey: Array.isArray(header) ? header[0] : header,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      });
      const route = routes[`${req.method} ${url.split('?')[0]}`] ?? {
        status: 500,
        body: { error: { code: 'unexpected_route', message: `Unexpected ${req.method} ${url}` } },
      };
      res.writeHead(route.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(route.body));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

/** Async CLI run so the in-process fake API can answer while the CLI waits. */
function runCli(args: string[], baseUrl: string) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-roast-planning-home-'));
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

const roastId = 4529;
const roastRevision = '2026-09-30T14:22:05.123456+00:00';
const profileId = '5ea1af6f-234c-43a9-9bf8-5678dd24f854';
const revisionId = '8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4';
const generatedProfileId = '0b7e9f52-3c61-4d8a-9e24-6f1a8c3d5b90';
const generatedRevisionId = 'c43a1d7e-95b2-4e06-8f7c-1d2b3a4e5f68';

const changes = {
  title: 'Guji, later development',
  changes: {
    temperatureAdjustments: [
      { kind: 'bean_temperature', startMilliseconds: 300000, endMilliseconds: 420000, delta: 3 },
    ],
  },
};

function writeRequestFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'purvey-roast-planning-request-'));
  const file = join(dir, 'changes.json');
  writeFileSync(file, JSON.stringify(changes));
  return file;
}

const candidates = {
  data: {
    roasts: [
      {
        roastId,
        roastRevision,
        label: 'Ethiopia Guji (roast #4529)',
        batchName: 'Ethiopia Guji',
        coffeeName: 'Ethiopia Guji',
        roastDate: '2026-09-30',
        reference: { profileId, revisionId, saved: false },
      },
    ],
    eligibleCount: 1,
    totalRoastCount: 58,
    ineligibleRoastCount: 57,
  },
  meta: {
    resource: 'reference-profile-roast-candidates',
    namespace: '/v1/reference-profiles',
    version: 'v1',
  },
};

const preview = {
  data: {
    parentRevisionId: revisionId,
    parentProfileId: profileId,
    parentSaved: false,
    title: changes.title,
    changes: changes.changes,
    measuredFacts: { temperatureUnit: 'F', adjustments: [], eventsUnchanged: true },
    chart: { temperatureUnit: 'F', chargeTimeMilliseconds: 0, series: [], events: [] },
    exportEligible: true,
    sourceRoast: { id: roastId, revision: roastRevision, label: 'Ethiopia Guji (roast #4529)' },
  },
  meta: { resource: 'reference-profile-previews', namespace: '/v1/reference-profiles' },
};

const roastReference = {
  data: {
    id: profileId,
    currentRevisionId: revisionId,
    title: 'Ethiopia Guji (roast #4529)',
    currentRevision: {
      id: revisionId,
      sourceRoast: { id: roastId, revision: roastRevision },
    },
  },
  meta: { resource: 'reference-profiles' },
};

const noStoredFile = {
  error: {
    code: 'roast_artisan_source_unavailable',
    message:
      'Roast #4470 was imported before Artisan files were kept, so only its curve is on record and it cannot be the base for a planned profile. Re-import its Artisan .alog onto the roast, or upload the .alog as a reference profile, then try again. The roast can still be compared with other profiles.',
    reason: 'artisan_file_not_retained',
  },
};

const noStudio = {
  error: { code: 'forbidden', message: 'Reference profiles require Mallard Studio access' },
};

const roastDetail = (id: number) => ({
  data: { roast_id: id, last_updated: roastRevision },
  meta: { resource: 'roasts' },
});

const ROAST_WRITE = /^(POST|PUT|PATCH|DELETE) \/v1\/roasts/;

describe('reference-profile roasts', () => {
  it('returns the eligible-roast list unchanged and sends --limit as the only query', async () => {
    await withFakeApi(
      { 'GET /v1/reference-profiles/from-roast/candidates': { status: 200, body: candidates } },
      async (baseUrl, requests) => {
        const listed = await runCli(['reference-profile', 'roasts', '--json'], baseUrl);
        expect(listed.status).toBe(0);
        expect(parseJson(listed.stdout)).toEqual(candidates);

        const limited = await runCli(
          ['reference-profile', 'roasts', '--limit', '50', '--json'],
          baseUrl
        );
        expect(limited.status).toBe(0);

        expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          'GET /v1/reference-profiles/from-roast/candidates',
          'GET /v1/reference-profiles/from-roast/candidates?limit=50',
        ]);
        expect(requests[0].authorization).toBe('Bearer pk_test_fake');
      }
    );
  }, 30000);

  it('rejects an out-of-range --limit without calling the API', async () => {
    await withFakeApi({}, async (baseUrl, requests) => {
      const result = await runCli(
        ['reference-profile', 'roasts', '--limit', '51', '--json'],
        baseUrl
      );
      expect(result.status).toBe(2);
      expect(parseJson(result.stderr)).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
      expect(parseJson(result.stderr).message).toContain('between 1 and 50');
      expect(requests).toEqual([]);
    });
  }, 30000);

  it('relays a missing Studio entitlement with exit 3', async () => {
    await withFakeApi(
      { 'GET /v1/reference-profiles/from-roast/candidates': { status: 403, body: noStudio } },
      async (baseUrl) => {
        const result = await runCli(['reference-profile', 'roasts', '--json'], baseUrl);
        expect(result.status).toBe(3);
        expect(result.stdout).toBe('');
        expect(parseJson(result.stderr)).toMatchObject({
          error: true,
          code: 'AUTH_ERROR',
          exitCode: 3,
          message: noStudio.error.message,
        });
      }
    );
  }, 30000);
});

describe('reference-profile preview-from-roast', () => {
  it("reads the roast's current revision, then previews without writing anything", async () => {
    const requestFile = writeRequestFile();
    await withFakeApi(
      {
        [`GET /v1/roasts/${roastId}`]: { status: 200, body: roastDetail(roastId) },
        'POST /v1/reference-profiles/from-roast/preview': { status: 200, body: preview },
      },
      async (baseUrl, requests) => {
        const result = await runCli(
          [
            'reference-profile',
            'preview-from-roast',
            String(roastId),
            '--request',
            requestFile,
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(parseJson(result.stdout)).toEqual(preview);
        expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `GET /v1/roasts/${roastId}`,
          'POST /v1/reference-profiles/from-roast/preview',
        ]);
        expect(requests[1].body).toEqual({ ...changes, roastId, roastRevision });
        expect(requests[1].idempotencyKey).toBeUndefined();
        expect(
          requests.some((request) => ROAST_WRITE.test(`${request.method} ${request.url}`))
        ).toBe(false);
      }
    );
  }, 30000);

  it('sends an explicit --roast-revision without reading the roast first', async () => {
    const requestFile = writeRequestFile();
    await withFakeApi(
      { 'POST /v1/reference-profiles/from-roast/preview': { status: 200, body: preview } },
      async (baseUrl, requests) => {
        const result = await runCli(
          [
            'reference-profile',
            'preview-from-roast',
            String(roastId),
            '--roast-revision',
            'pinned-revision',
            '--request',
            requestFile,
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(requests).toHaveLength(1);
        expect(requests[0].body).toEqual({ ...changes, roastId, roastRevision: 'pinned-revision' });
      }
    );
  }, 30000);

  it("relays Parchment's reason when the roast has no stored Artisan file (exit 2)", async () => {
    const requestFile = writeRequestFile();
    await withFakeApi(
      {
        'GET /v1/roasts/4470': { status: 200, body: roastDetail(4470) },
        'POST /v1/reference-profiles/from-roast/preview': { status: 400, body: noStoredFile },
      },
      async (baseUrl) => {
        const result = await runCli(
          ['reference-profile', 'preview-from-roast', '4470', '--request', requestFile, '--json'],
          baseUrl
        );
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(parseJson(result.stderr)).toMatchObject({
          error: true,
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
          message: noStoredFile.error.message,
        });
      }
    );
  }, 30000);

  it('exits 4 for a roast the account does not own and 2 for a malformed roast id', async () => {
    const requestFile = writeRequestFile();
    await withFakeApi(
      {
        'GET /v1/roasts/999': {
          status: 404,
          body: { error: { code: 'not_found', message: 'Roast not found' } },
        },
      },
      async (baseUrl, requests) => {
        const missing = await runCli(
          ['reference-profile', 'preview-from-roast', '999', '--request', requestFile, '--json'],
          baseUrl
        );
        expect(missing.status).toBe(4);
        expect(parseJson(missing.stderr)).toMatchObject({ code: 'NOT_FOUND', exitCode: 4 });

        const malformed = await runCli(
          [
            'reference-profile',
            'preview-from-roast',
            'roast:999',
            '--request',
            requestFile,
            '--json',
          ],
          baseUrl
        );
        expect(malformed.status).toBe(2);
        expect(requests).toHaveLength(1);
      }
    );
  }, 30000);
});

describe('reference-profile from-roast and the plan save', () => {
  it("saves the roast's Artisan file as a reference, then saves the plan under it", async () => {
    const requestFile = writeRequestFile();
    const generated = {
      data: { id: generatedProfileId, currentRevisionId: generatedRevisionId },
      meta: { resource: 'reference-profiles' },
    };
    await withFakeApi(
      {
        [`GET /v1/roasts/${roastId}`]: { status: 200, body: roastDetail(roastId) },
        'POST /v1/reference-profiles/from-roast': { status: 201, body: roastReference },
        [`POST /v1/reference-profiles/${profileId}/revisions/${revisionId}/generated`]: {
          status: 201,
          body: generated,
        },
      },
      async (baseUrl, requests) => {
        const saved = await runCli(
          [
            'reference-profile',
            'from-roast',
            String(roastId),
            '--artisan-source',
            '--title',
            'Guji baseline',
            '--idempotency-key',
            'from-roast-key',
            '--json',
          ],
          baseUrl
        );
        expect(saved.status).toBe(0);
        const reference = parseJson(saved.stdout) as typeof roastReference;
        expect(reference).toEqual(roastReference);

        const plan = await runCli(
          [
            'reference-profile',
            'save',
            reference.data.id,
            reference.data.currentRevisionId,
            '--request',
            requestFile,
            '--json',
          ],
          baseUrl
        );
        expect(plan.status).toBe(0);
        expect(parseJson(plan.stdout)).toEqual(generated);

        expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
          `GET /v1/roasts/${roastId}`,
          'POST /v1/reference-profiles/from-roast',
          `POST /v1/reference-profiles/${profileId}/revisions/${revisionId}/generated`,
        ]);
        expect(requests[1].body).toEqual({
          roastId,
          roastRevision,
          basis: 'artisan_source',
          title: 'Guji baseline',
        });
        expect(requests[1].idempotencyKey).toBe('from-roast-key');
        expect(requests[2].body).toEqual(changes);
        expect(requests[2].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
        // Neither step creates, edits, or duplicates a roast.
        expect(
          requests.some((request) => ROAST_WRITE.test(`${request.method} ${request.url}`))
        ).toBe(false);
      }
    );
  }, 30000);

  it('returns the reference already saved from the roast (200) and defaults to a comparison chart', async () => {
    await withFakeApi(
      { 'POST /v1/reference-profiles/from-roast': { status: 200, body: roastReference } },
      async (baseUrl, requests) => {
        const again = await runCli(
          [
            'reference-profile',
            'from-roast',
            String(roastId),
            '--artisan-source',
            '--roast-revision',
            roastRevision,
            '--json',
          ],
          baseUrl
        );
        expect(again.status).toBe(0);
        expect(parseJson(again.stdout)).toEqual(roastReference);

        const snapshot = await runCli(
          [
            'reference-profile',
            'from-roast',
            String(roastId),
            '--roast-revision',
            roastRevision,
            '--json',
          ],
          baseUrl
        );
        expect(snapshot.status).toBe(0);

        expect(requests.map((request) => request.body)).toEqual([
          { roastId, roastRevision, basis: 'artisan_source' },
          { roastId, roastRevision, basis: 'chart_snapshot' },
        ]);
        expect(requests[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
        expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
      }
    );
  }, 30000);

  it('maps no stored file to exit 2 and a changed roast to exit 5, writing nothing locally', async () => {
    await withFakeApi(
      { 'POST /v1/reference-profiles/from-roast': { status: 400, body: noStoredFile } },
      async (baseUrl) => {
        const result = await runCli(
          [
            'reference-profile',
            'from-roast',
            '4470',
            '--artisan-source',
            '--roast-revision',
            roastRevision,
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(parseJson(result.stderr).message).toBe(noStoredFile.error.message);
      }
    );

    const conflict = {
      error: {
        code: 'conflict',
        message: 'The executed roast changed; reload it and use the current revision token',
      },
    };
    await withFakeApi(
      { 'POST /v1/reference-profiles/from-roast': { status: 409, body: conflict } },
      async (baseUrl) => {
        const result = await runCli(
          [
            'reference-profile',
            'from-roast',
            String(roastId),
            '--artisan-source',
            '--roast-revision',
            'stale-revision',
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(5);
        expect(parseJson(result.stderr)).toMatchObject({
          code: 'DEPENDENCY_CONFLICT',
          exitCode: 5,
          message: conflict.error.message,
        });
      }
    );
  }, 30000);
});

describe('roast from-reference', () => {
  const created = {
    data: {
      roast: { roast_id: 4600, batch_name: 'Ethiopia Guji #4', coffee_id: 7, temperatures: [] },
      import: { fileName: 'ethiopia.alog', temperaturePoints: 612, milestoneEvents: 6 },
      reference: { profileId, revisionId, linked: true },
    },
    meta: { resource: 'roasts', namespace: '/v1/roasts', version: 'v1' },
  };

  it('creates the roast from the saved reference and returns the response unchanged', async () => {
    await withFakeApi(
      { 'POST /v1/roasts/imports/from-reference': { status: 201, body: created } },
      async (baseUrl, requests) => {
        const result = await runCli(
          [
            'roast',
            'from-reference',
            profileId,
            revisionId,
            '--coffee-id',
            '7',
            '--batch-name',
            'Ethiopia Guji #4',
            '--roast-date',
            '2026-10-03',
            '--oz-in',
            '16',
            '--oz-out',
            '13.6',
            '--roast-notes',
            'Smooth',
            '--roast-targets',
            '18% development',
            '--idempotency-key',
            'roast-from-reference-key',
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(parseJson(result.stdout)).toEqual(created);
        expect(requests).toHaveLength(1);
        expect(requests[0].body).toEqual({
          referenceProfileId: profileId,
          referenceRevisionId: revisionId,
          coffeeId: 7,
          batchName: 'Ethiopia Guji #4',
          roastDate: '2026-10-03',
          ozIn: 16,
          ozOut: 13.6,
          roastNotes: 'Smooth',
          roastTargets: '18% development',
        });
        expect(requests[0].idempotencyKey).toBe('roast-from-reference-key');
        expect(requests[0].authorization).toBe('Bearer pk_test_fake');
      }
    );
  }, 30000);

  it('sends only the required fields and a generated idempotency key by default', async () => {
    await withFakeApi(
      { 'POST /v1/roasts/imports/from-reference': { status: 201, body: created } },
      async (baseUrl, requests) => {
        const result = await runCli(
          ['roast', 'from-reference', profileId, revisionId, '--coffee-id', '7', '--json'],
          baseUrl
        );
        expect(result.status).toBe(0);
        expect(requests[0].body).toEqual({
          referenceProfileId: profileId,
          referenceRevisionId: revisionId,
          coffeeId: 7,
        });
        expect(requests[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      }
    );
  }, 30000);

  it('never records a planned profile as a roast: the refusal is relayed with exit 2', async () => {
    const refusal = {
      error: {
        code: 'invalid_reference_profile',
        message: 'Only an uploaded Artisan reference can be recorded as a roast',
      },
    };
    await withFakeApi(
      { 'POST /v1/roasts/imports/from-reference': { status: 400, body: refusal } },
      async (baseUrl) => {
        const result = await runCli(
          [
            'roast',
            'from-reference',
            generatedProfileId,
            generatedRevisionId,
            '--coffee-id',
            '7',
            '--json',
          ],
          baseUrl
        );
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).not.toContain('created');
        expect(parseJson(result.stderr)).toMatchObject({
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
          message: refusal.error.message,
        });
      }
    );
  }, 30000);

  it('maps missing access to exit 3 and an unknown reference or coffee to exit 4', async () => {
    await withFakeApi(
      { 'POST /v1/roasts/imports/from-reference': { status: 403, body: noStudio } },
      async (baseUrl) => {
        const result = await runCli(
          ['roast', 'from-reference', profileId, revisionId, '--coffee-id', '7', '--json'],
          baseUrl
        );
        expect(result.status).toBe(3);
        expect(parseJson(result.stderr).message).toBe(noStudio.error.message);
      }
    );
    await withFakeApi(
      {
        'POST /v1/roasts/imports/from-reference': {
          status: 404,
          body: { error: { code: 'not_found', message: 'Reference profile not found' } },
        },
      },
      async (baseUrl) => {
        const result = await runCli(
          ['roast', 'from-reference', profileId, revisionId, '--coffee-id', '7', '--json'],
          baseUrl
        );
        expect(result.status).toBe(4);
        expect(parseJson(result.stderr)).toMatchObject({ code: 'NOT_FOUND', exitCode: 4 });
      }
    );
  }, 30000);

  it('rejects malformed input before calling the API', async () => {
    await withFakeApi({}, async (baseUrl, requests) => {
      const cases: string[][] = [
        ['roast', 'from-reference', profileId, revisionId, '--json'],
        ['roast', 'from-reference', 'not-a-uuid', revisionId, '--coffee-id', '7', '--json'],
        ['roast', 'from-reference', profileId, revisionId, '--coffee-id', '7abc', '--json'],
        [
          'roast',
          'from-reference',
          profileId,
          revisionId,
          '--coffee-id',
          '7',
          '--roast-date',
          '10/03/2026',
          '--json',
        ],
        ['roast', 'from-reference', profileId, revisionId, '--coffee-id', '7', '--oz-out', '0'],
      ];
      for (const args of cases) {
        const result = await runCli(args, baseUrl);
        expect(result.status, args.join(' ')).toBe(2);
        expect(parseJson(result.stderr), args.join(' ')).toMatchObject({
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
        });
      }
      expect(requests).toEqual([]);
    });
  }, 60000);
});
