import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
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

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r/g, '');
}

function parseJson(text: string) {
  return JSON.parse(stripAnsi(text).trim()) as Record<string, unknown>;
}

/**
 * Run the CLI with an isolated HOME and no Parchment credentials/API key so
 * the auth-required path is deterministic and no network call is made.
 */
function runCli(args: string[]) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-price-index-home-'));
  const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');
  return spawnSync(tsxBin, ['src/index.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
    env: {
      ...process.env,
      HOME: home,
      PARCHMENT_API_KEY: '',
      PURVEYORS_API_KEY: '',
    },
  });
}

describe('price-index command', () => {
  it('documents its filter and pagination options in help output', () => {
    const result = runCli(['price-index', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('--origin <origin>');
    expect(stdout).toContain('--process <method>');
    expect(stdout).toContain('--grade <grade>');
    expect(stdout).toContain('--from <date>');
    expect(stdout).toContain('--to <date>');
    expect(stdout).toContain('--wholesale <true|false>');
    expect(stdout).toContain('--page <n>');
    expect(stdout).toContain('--limit <n>');
  }, 15000);

  it('rejects a non-positive --page before auth', () => {
    const result = runCli(['price-index', '--page', '0', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--page');
  }, 15000);

  it('rejects a suffixed --limit before auth', () => {
    const result = runCli(['price-index', '--limit', '25rows', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--limit');
  }, 15000);

  it('rejects an invalid --wholesale value before auth', () => {
    const result = runCli(['price-index', '--wholesale', 'maybe', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ error: true, code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--wholesale');
  }, 15000);

  it('requires a session or API key when none is configured', () => {
    const result = runCli(['price-index', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(3);
    expect(stderr).toMatchObject({ error: true, code: 'AUTH_ERROR', exitCode: 3 });
  }, 15000);

  it('lists the comparison and history subcommands in help output', () => {
    const result = runCli(['price-index', '--help']);
    const stdout = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(stdout).toContain('comparisons');
    expect(stdout).toContain('comparison');
    expect(stdout).toContain('history');
  }, 15000);

  it('rejects an invalid comparisons --wholesale value before auth', () => {
    const result = runCli(['price-index', 'comparisons', '--wholesale', 'maybe', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('true, false, all');
  }, 15000);

  it('requires --origin, --from, and --to on comparison before auth', () => {
    const result = runCli(['price-index', 'comparison', '--origin', 'Kenya', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--from');
  }, 15000);

  it('rejects snapshot-only filters on subcommands instead of ignoring them', () => {
    const result = runCli(['price-index', 'history', '--grade', 'AA', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--grade');
  }, 15000);

  it('rejects an out-of-range history --window-days before any network call', () => {
    const result = runCli(['price-index', 'history', '--window-days', '366', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(2);
    expect(stderr).toMatchObject({ code: 'INVALID_ARGUMENT', exitCode: 2 });
    expect(stderr.message).toContain('--window-days');
  }, 15000);

  it('requires a session or API key for comparisons when none is configured', () => {
    const result = runCli(['price-index', 'comparisons', '--json']);
    const stderr = parseJson(result.stderr);

    expect(result.status).toBe(3);
    expect(stderr).toMatchObject({ code: 'AUTH_ERROR', exitCode: 3 });
  }, 15000);
});

interface RecordedRequest {
  url: string;
  authorization?: string;
}

async function withApi(
  body: unknown,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
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
function runCliAsync(args: string[], env: Record<string, string>) {
  const home = mkdtempSync(resolve(tmpdir(), 'purvey-price-index-home-'));
  const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolveRun, rejectRun) => {
      const child = spawn(tsxBin, ['src/index.ts', ...args], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, PURVEYORS_API_KEY: '', ...env },
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

describe('price-index canonical reads', () => {
  const comparisons = {
    windowDays: 30,
    from: '2026-08-31',
    to: '2026-09-30',
    comparisons: [
      {
        from: '2026-08-31',
        to: '2026-09-30',
        origin: 'Brazil',
        wholesale: false,
        status: 'available',
        changePercent: -1.0222,
        sample: {
          fromListings: 29,
          toListings: 32,
          matchedListings: 17,
          matchedSuppliers: 13,
          matchedCoverage: 0.5862,
        },
        methodology: 'matched-supplier-median-log-v1',
        canonicalPublication: false,
        significance: {
          method: 'matched-30d-weekly-abs-percentile-v1',
          baselineWindows: 2,
          requiredBaselineWindows: 8,
          baselineMedianAbsChangePercent: 1.1474,
          movePercentile: null,
          classification: null,
        },
      },
      {
        from: '2026-08-31',
        to: '2026-09-30',
        origin: 'Ethiopia',
        wholesale: false,
        status: 'available',
        changePercent: 4.1,
        sample: {
          fromListings: 67,
          toListings: 93,
          matchedListings: 46,
          matchedSuppliers: 17,
          matchedCoverage: 0.6866,
        },
        methodology: 'matched-supplier-median-log-v1',
        canonicalPublication: false,
        significance: {
          method: 'matched-30d-weekly-abs-percentile-v1',
          baselineWindows: 12,
          requiredBaselineWindows: 8,
          baselineMedianAbsChangePercent: 1.2,
          movePercentile: 0.98,
          classification: 'exceptional',
        },
      },
      {
        from: '2026-08-31',
        to: '2026-09-30',
        origin: 'Kenya',
        wholesale: true,
        status: 'available',
        changePercent: 0.5,
        sample: {
          fromListings: 20,
          toListings: 21,
          matchedListings: 12,
          matchedSuppliers: 5,
          matchedCoverage: 0.6,
        },
        methodology: 'matched-supplier-median-log-v1',
        canonicalPublication: false,
        significance: null,
      },
    ],
  };

  it('emits comparisons verbatim, preserving null and non-null significance classifications', async () => {
    await withApi(comparisons, async (baseUrl, requests) => {
      const result = await runCliAsync(
        ['price-index', 'comparisons', '--wholesale', 'all', '--json'],
        { PARCHMENT_API_BASE_URL: baseUrl, PARCHMENT_API_KEY: 'test-key' }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(comparisons);
      expect(requests).toEqual([
        {
          url: '/v1/price-index/comparisons?wholesale=all',
          authorization: 'Bearer test-key',
        },
      ]);
    });
  }, 20000);

  it('forwards comparison bounds unchanged and emits the response verbatim', async () => {
    // The single-comparison endpoint carries no significance field.
    const comparison: Record<string, unknown> = { ...comparisons.comparisons[0] };
    delete comparison.significance;
    await withApi(comparison, async (baseUrl, requests) => {
      const result = await runCliAsync(
        [
          'price-index',
          'comparison',
          '--origin',
          'Brazil',
          '--from',
          '2026-08-31',
          '--to',
          '2026-09-30',
          '--wholesale',
          'false',
          '--json',
        ],
        { PARCHMENT_API_BASE_URL: baseUrl, PARCHMENT_API_KEY: 'test-key' }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(comparison);
      const url = new URL(requests[0].url, baseUrl);
      expect(url.pathname).toBe('/v1/price-index/comparison');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        origin: 'Brazil',
        from: '2026-08-31',
        to: '2026-09-30',
        wholesale: 'false',
      });
    });
  }, 20000);

  it('reads the public history slice without credentials', async () => {
    const history = {
      data: [],
      pagination: { page: 1, limit: 5, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      meta: { resource: 'price-index-history' },
    };
    await withApi(history, async (baseUrl, requests) => {
      const result = await runCliAsync(
        ['price-index', 'history', '--window-days', '30', '--limit', '5', '--order', 'desc'],
        { PARCHMENT_API_BASE_URL: baseUrl, PARCHMENT_API_KEY: '' }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(history);
      const url = new URL(requests[0].url, baseUrl);
      expect(url.pathname).toBe('/v1/price-index/history');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        windowDays: '30',
        limit: '5',
        order: 'desc',
      });
      expect(requests[0].authorization).toBeUndefined();
    });
  }, 20000);
});
