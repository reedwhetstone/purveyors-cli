import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function parseJson(text: string): unknown {
  return JSON.parse(text.replace(ANSI_PATTERN, '').replace(/\r/g, '').trim());
}

const WEDNESDAY = '11111111-1111-4111-8111-111111111111';
const GUJI_TEST = '22222222-2222-4222-8222-222222222222';
const FRIDAY = '33333333-3333-4333-8333-333333333333';
const FRIDAY_AGAIN = '44444444-4444-4444-8444-444444444444';

interface StoredRoast {
  roast_id: number;
  coffee_id: number;
  coffee_name: string;
  batch_id: string;
  batch_name: string;
  roast_date: string;
  weight_loss_percent: number | null;
  is_wholesale: boolean;
}

/** Newest roast date first, then highest roast ID: the order the roast list returns. */
const ROASTS: StoredRoast[] = [
  {
    roast_id: 4531,
    coffee_id: 7,
    coffee_name: 'Ethiopia Guji',
    batch_id: WEDNESDAY,
    batch_name: 'wednesday',
    roast_date: '2026-09-30',
    weight_loss_percent: 14,
    is_wholesale: false,
  },
  {
    roast_id: 4530,
    coffee_id: 7,
    coffee_name: 'Ethiopia Guji',
    batch_id: WEDNESDAY,
    batch_name: 'wednesday',
    roast_date: '2026-09-30',
    weight_loss_percent: 16,
    is_wholesale: false,
  },
  {
    roast_id: 4529,
    coffee_id: 9,
    coffee_name: 'Colombia Huila',
    batch_id: GUJI_TEST,
    batch_name: 'Guji test',
    roast_date: '2026-09-28',
    weight_loss_percent: null,
    is_wholesale: true,
  },
  {
    roast_id: 45,
    coffee_id: 11,
    coffee_name: 'Kenya Lot 4531 AA',
    batch_id: FRIDAY,
    batch_name: 'friday',
    roast_date: '2026-09-25',
    weight_loss_percent: null,
    is_wholesale: true,
  },
  {
    // A coffee with no catalog listing: retail, never wholesale.
    roast_id: 12,
    coffee_id: 13,
    coffee_name: 'Neighbor trade lot',
    batch_id: FRIDAY_AGAIN,
    batch_name: 'friday',
    roast_date: '2026-09-18',
    weight_loss_percent: 12,
    is_wholesale: false,
  },
];

function invalidQuery(field: string, message: string) {
  return { status: 400, body: { error: { code: 'invalid_query', message, field } } };
}

const contains = (value: string, text: string) => value.toLowerCase().includes(text.toLowerCase());

/**
 * Stand-in for the roast list with the rules the CLI documents: `q` matches the
 * coffee name, the batch name, or an exact roast ID; `is_wholesale` splits the
 * list in two; every filter narrows together; and `meta.totals` counts the whole
 * filtered set whatever page is requested.
 */
function listRoastsResponse(params: URLSearchParams): { status: number; body: unknown } {
  let rows = ROASTS;

  const q = params.get('q')?.trim();
  if (q) {
    if (q.length > 100) return invalidQuery('q', 'q must be at most 100 characters');
    if (/[\u0000-\u001f\u007f]/.test(q)) {
      return invalidQuery('q', 'q must not contain control characters');
    }
    const id = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : undefined;
    rows = rows.filter(
      (roast) =>
        contains(roast.coffee_name, q) || contains(roast.batch_name, q) || roast.roast_id === id
    );
  }

  const wholesale = params.get('is_wholesale')?.trim().toLowerCase();
  if (wholesale) {
    if (wholesale !== 'true' && wholesale !== 'false') {
      return invalidQuery('is_wholesale', 'is_wholesale must be true or false');
    }
    rows = rows.filter((roast) => roast.is_wholesale === (wholesale === 'true'));
  }

  const coffeeName = params.get('coffee_name');
  if (coffeeName) rows = rows.filter((roast) => contains(roast.coffee_name, coffeeName));
  const batchName = params.get('batch_name');
  if (batchName) rows = rows.filter((roast) => contains(roast.batch_name, batchName));
  const roastId = params.get('roast_id');
  if (roastId) rows = rows.filter((roast) => roast.roast_id === Number(roastId));
  const dateStart = params.get('date_start');
  if (dateStart) rows = rows.filter((roast) => roast.roast_date >= dateStart);

  const losses = rows.flatMap((roast) =>
    roast.weight_loss_percent === null ? [] : [roast.weight_loss_percent]
  );
  const offset = Number(params.get('offset') ?? 0);
  const limit = Number(params.get('limit') ?? 20);

  return {
    status: 200,
    body: {
      data: rows.slice(offset, offset + limit),
      meta: {
        resource: 'roasts',
        namespace: '/v1/roasts',
        version: 'v1',
        auth: { kind: 'api-key', role: 'member', apiPlan: 'member' },
        totals: {
          roasts: rows.length,
          batches: new Set(rows.map((roast) => roast.batch_id)).size,
          average_loss_percent:
            losses.length > 0 ? losses.reduce((sum, loss) => sum + loss, 0) / losses.length : null,
        },
      },
    },
  };
}

async function withRoastApi(run: (baseUrl: string, queries: URLSearchParams[]) => Promise<void>) {
  const queries: URLSearchParams[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://127.0.0.1');
    const route =
      req.method === 'GET' && url.pathname === '/v1/roasts'
        ? listRoastsResponse(url.searchParams)
        : {
            status: 500,
            body: { error: { code: 'unexpected_route', message: `Unexpected ${req.url}` } },
          };
    if (url.pathname === '/v1/roasts') queries.push(url.searchParams);
    res.writeHead(route.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(route.body));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, queries);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

/** Async CLI run so the in-process stand-in can answer while the CLI waits. */
function runCli(args: string[], baseUrl: string) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-roast-list-home-'));
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

interface RoastPage {
  data: StoredRoast[];
  meta: {
    totals: { roasts: number; batches: number; average_loss_percent: number | null };
    [key: string]: unknown;
  };
}

const ids = (rows: StoredRoast[]) => rows.map((roast) => roast.roast_id);

async function listIds(args: string[], baseUrl: string): Promise<number[]> {
  const result = await runCli(['roast', 'list', ...args], baseUrl);
  expect(result.status, result.stderr).toBe(0);
  return ids(parseJson(result.stdout) as StoredRoast[]);
}

async function listPage(args: string[], baseUrl: string): Promise<RoastPage> {
  const result = await runCli(['roast', 'list', '--include-totals', ...args], baseUrl);
  expect(result.status, result.stderr).toBe(0);
  return parseJson(result.stdout) as RoastPage;
}

const TIMEOUT = 60_000;

describe('roast list --search', () => {
  it(
    'sends the text as q and prints the matching roasts as a list',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        // "guji" is in two coffee names and one batch name; letter case does not matter.
        const result = await runCli(['roast', 'list', '--search', 'GUJI'], baseUrl);

        expect(result.status, result.stderr).toBe(0);
        const rows = parseJson(result.stdout);
        expect(Array.isArray(rows)).toBe(true);
        expect(ids(rows as StoredRoast[])).toEqual([4531, 4530, 4529]);
        expect(queries).toHaveLength(1);
        expect(queries[0].get('q')).toBe('GUJI');
        expect(queries[0].has('is_wholesale')).toBe(false);
      });
    },
    TIMEOUT
  );

  it(
    'finds a roast by its ID, with or without a leading #, and never by part of an ID',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        // 4531 is a roast ID and also appears in another coffee's name.
        expect(await listIds(['--search', '4531'], baseUrl)).toEqual([4531, 45]);
        expect(await listIds(['--search', '#4529'], baseUrl)).toEqual([4529]);
        expect(queries.map((query) => query.get('q'))).toEqual(['4531', '#4529']);

        // 453 is the start of three roast IDs and of one name; only the name matches.
        expect(await listIds(['--search', '453'], baseUrl)).toEqual([45]);
      });
    },
    TIMEOUT
  );

  it(
    'narrows together with --coffee-name, --batch-name, --roast-id, and a date',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        expect(await listIds(['--search', 'guji', '--coffee-name', 'colombia'], baseUrl)).toEqual([
          4529,
        ]);
        expect(queries[0].get('q')).toBe('guji');
        expect(queries[0].get('coffee_name')).toBe('colombia');

        expect(await listIds(['--search', 'guji', '--batch-name', 'wednesday'], baseUrl)).toEqual([
          4531, 4530,
        ]);
        expect(queries[1].get('batch_name')).toBe('wednesday');

        expect(await listIds(['--search', 'guji', '--roast-id', '4530'], baseUrl)).toEqual([4530]);
        expect(queries[2].get('roast_id')).toBe('4530');

        expect(await listIds(['--search', 'guji', '--date-start', '2026-09-29'], baseUrl)).toEqual([
          4531, 4530,
        ]);
        expect(queries[3].get('date_start')).toBe('2026-09-29');

        // The older filters still work alone, and send no search.
        expect(await listIds(['--coffee-name', 'kenya'], baseUrl)).toEqual([45]);
        expect(queries[4].has('q')).toBe(false);
      });
    },
    TIMEOUT
  );

  it(
    'prints nothing on stdout when a search matches no roast',
    async () => {
      await withRoastApi(async (baseUrl) => {
        const result = await runCli(['roast', 'list', '--search', 'sumatra'], baseUrl);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('No roast profiles found.');
      });
    },
    TIMEOUT
  );

  it(
    'refuses text over 100 characters before sending a request',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const result = await runCli(
          ['roast', 'list', '--search', 'x'.repeat(101), '--json'],
          baseUrl
        );

        expect(result.status).toBe(2);
        expect(parseJson(result.stderr)).toMatchObject({
          error: true,
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
          message: 'Invalid --search: must be at most 100 characters.',
        });
        expect(result.stdout).toBe('');
        expect(queries).toHaveLength(0);
      });
    },
    TIMEOUT
  );

  it(
    'sends text of exactly 100 characters, counted without surrounding spaces',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const text = 'x'.repeat(100);

        expect((await runCli(['roast', 'list', '--search', text], baseUrl)).status).toBe(0);
        expect((await runCli(['roast', 'list', '--search', `  ${text}  `], baseUrl)).status).toBe(
          0
        );
        expect(queries.map((query) => query.get('q'))).toEqual([text, `  ${text}  `]);
      });
    },
    TIMEOUT
  );

  it(
    'relays the reason when the search text is refused, with exit code 2',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const result = await runCli(['roast', 'list', '--search', 'gu\u0007ji', '--json'], baseUrl);

        expect(queries).toHaveLength(1);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
        expect(parseJson(result.stderr)).toMatchObject({
          error: true,
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
          message: 'q must not contain control characters',
        });
      });
    },
    TIMEOUT
  );
});

describe('roast list --wholesale', () => {
  it(
    'sends true or false as is_wholesale, and nothing when left out',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        expect(await listIds(['--wholesale', 'true'], baseUrl)).toEqual([4529, 45]);
        // A roast of a coffee with no catalog listing (12) counts as retail.
        expect(await listIds(['--wholesale', 'FALSE'], baseUrl)).toEqual([4531, 4530, 12]);
        expect(await listIds([], baseUrl)).toEqual([4531, 4530, 4529, 45, 12]);

        expect(queries.map((query) => query.get('is_wholesale'))).toEqual(['true', 'false', null]);
      });
    },
    TIMEOUT
  );

  it(
    'combines with --search',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        expect(await listIds(['--search', 'guji', '--wholesale', 'true'], baseUrl)).toEqual([4529]);
        expect(await listIds(['--search', 'friday', '--wholesale', 'false'], baseUrl)).toEqual([
          12,
        ]);
        expect(queries[1].get('q')).toBe('friday');
        expect(queries[1].get('is_wholesale')).toBe('false');
      });
    },
    TIMEOUT
  );

  it(
    'refuses a value other than true or false before sending a request',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const result = await runCli(['roast', 'list', '--wholesale', 'retail', '--json'], baseUrl);

        expect(result.status).toBe(2);
        expect(parseJson(result.stderr)).toMatchObject({
          code: 'INVALID_ARGUMENT',
          exitCode: 2,
          message: 'Invalid --wholesale: "retail". Must be "true" or "false".',
        });
        expect(queries).toHaveLength(0);
      });
    },
    TIMEOUT
  );
});

describe('roast list --include-totals', () => {
  it(
    'leaves the default output a list with no totals',
    async () => {
      await withRoastApi(async (baseUrl) => {
        const result = await runCli(['roast', 'list', '--limit', '2'], baseUrl);

        expect(result.status, result.stderr).toBe(0);
        expect(parseJson(result.stdout)).toEqual(ROASTS.slice(0, 2));
      });
    },
    TIMEOUT
  );

  it(
    'prints the page with totals for every roast the filters match',
    async () => {
      await withRoastApi(async (baseUrl) => {
        const page = await listPage([], baseUrl);

        expect(ids(page.data)).toEqual([4531, 4530, 4529, 45, 12]);
        // Two batches are named "friday"; they count as two.
        expect(page.meta.totals).toEqual({ roasts: 5, batches: 4, average_loss_percent: 14 });
        expect(page.meta.resource).toBe('roasts');

        const searched = await listPage(['--search', 'guji'], baseUrl);
        expect(ids(searched.data)).toEqual([4531, 4530, 4529]);
        expect(searched.meta.totals).toEqual({ roasts: 3, batches: 2, average_loss_percent: 15 });
      });
    },
    TIMEOUT
  );

  it(
    'reports the same totals on every page, and offset plus rows reaches totals.roasts on the last',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const seen: number[] = [];
        const limit = 2;
        let offset = 0;
        let pages = 0;

        for (;;) {
          const page = await listPage(
            ['--limit', String(limit), '--offset', String(offset)],
            baseUrl
          );
          expect(page.meta.totals).toEqual({ roasts: 5, batches: 4, average_loss_percent: 14 });
          seen.push(...ids(page.data));
          pages += 1;
          if (offset + page.data.length >= page.meta.totals.roasts) break;
          offset += limit;
        }

        expect(pages).toBe(3);
        expect(seen).toEqual([4531, 4530, 4529, 45, 12]);
        expect(queries.map((query) => query.get('offset'))).toEqual(['0', '2', '4']);
      });
    },
    TIMEOUT
  );

  it(
    'splits the totals between --wholesale true and false with nothing left out',
    async () => {
      await withRoastApi(async (baseUrl) => {
        const all = await listPage([], baseUrl);
        const wholesale = await listPage(['--wholesale', 'true'], baseUrl);
        const retail = await listPage(['--wholesale', 'false'], baseUrl);

        // No wholesale roast here has a recorded weight loss, so the average is null.
        expect(wholesale.meta.totals).toEqual({
          roasts: 2,
          batches: 2,
          average_loss_percent: null,
        });
        expect(retail.meta.totals).toEqual({ roasts: 3, batches: 2, average_loss_percent: 14 });
        expect(wholesale.meta.totals.roasts + retail.meta.totals.roasts).toBe(
          all.meta.totals.roasts
        );
      });
    },
    TIMEOUT
  );

  it(
    'prints an empty page with totals of zero',
    async () => {
      await withRoastApi(async (baseUrl) => {
        const page = await listPage(['--search', 'sumatra'], baseUrl);

        expect(page.data).toEqual([]);
        expect(page.meta.totals).toEqual({ roasts: 0, batches: 0, average_loss_percent: null });
      });
    },
    TIMEOUT
  );

  it(
    'is refused with --csv before sending a request, and --csv alone still prints rows',
    async () => {
      await withRoastApi(async (baseUrl, queries) => {
        const refused = await runCli(['roast', 'list', '--include-totals', '--csv'], baseUrl);

        expect(refused.status).toBe(2);
        expect(parseJson(refused.stderr)).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
        expect(String((parseJson(refused.stderr) as { message: string }).message)).toContain(
          '--include-totals does not support --csv'
        );
        expect(queries).toHaveLength(0);

        const csv = await runCli(['roast', 'list', '--csv', '--limit', '1'], baseUrl);
        expect(csv.status, csv.stderr).toBe(0);
        const [header, row] = csv.stdout.trim().split('\n');
        expect(header.split(',')).toContain('roast_id');
        expect(row).toContain('4531');
      });
    },
    TIMEOUT
  );
});
