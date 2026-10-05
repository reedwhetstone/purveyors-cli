import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return {
    ...actual,
    createParchmentClient: vi.fn(),
    resolveParchmentSessionTokenIfAvailable: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../src/lib/output.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/output.js')>();
  return { ...actual, info: vi.fn(), success: vi.fn(), outputData: vi.fn() };
});
vi.mock('../src/lib/prompts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/prompts.js')>();
  return { ...actual, confirm: vi.fn() };
});

import type { Command } from 'commander';
import { buildRoastBatchCommand } from '../src/commands/roast-batch.js';
import {
  buildRoastCommand,
  createWatchBatchStore,
  createWatchRoastImporter,
} from '../src/commands/roast.js';
import { buildSalesCommand } from '../src/commands/sales.js';
import { createParchmentClient } from '../src/lib/parchment.js';
import { info, outputData, success } from '../src/lib/output.js';
import { confirm } from '../src/lib/prompts.js';
import {
  createRoastBatch,
  createRoastSchema,
  deleteRoastBatch,
  getRoastBatch,
  importRoastSchema,
  listRoastBatches,
  listRoastsSchema,
  parseRoastBatchId,
  updateRoastBatch,
  updateRoastSchema,
} from '../src/lib/roast.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LAST_WEEK = '11111111-1111-4111-8111-111111111111';
const THIS_WEEK = '22222222-2222-4222-8222-222222222222';

interface StoredBatch {
  id: string;
  name: string;
  batch_date: string;
}

interface StoredRoast {
  roast_id: number;
  coffee_id: number;
  batch_id: string;
  roast_date: string;
}

const ok = <T>(data: T, status = 200) => ({ data, response: new Response(null, { status }) });
const notFound = (message: string) => ({
  error: { error: { message } },
  response: new Response(null, { status: 404 }),
});

/**
 * In-memory stand-in for the roast batch API, with the rules the CLI relies on:
 * a create always opens a new batch, a roast written with a batch id joins that
 * batch whatever its date, a roast written with only a name joins the batch with
 * that name on its date or starts one, and deleting a batch deletes its roasts.
 */
function fakeBatchApi() {
  const batches: StoredBatch[] = [];
  const roasts: StoredRoast[] = [];
  let nextBatch = 1;
  let nextRoast = 101;

  const members = (batchId: string) => roasts.filter((roast) => roast.batch_id === batchId);
  const resource = (batch: StoredBatch) => {
    const held = members(batch.id);
    return {
      id: batch.id,
      // An empty batch reads under a placeholder name until it holds a roast.
      name: held.length > 0 ? batch.name : `Roast batch - ${batch.batch_date}`,
      batch_date: batch.batch_date,
      roast_count: held.length,
      roast_ids: held.map((roast) => roast.roast_id),
      coffee_ids: [...new Set(held.map((roast) => roast.coffee_id))],
      created_at: '2026-10-04T00:00:00Z',
      updated_at: '2026-10-04T00:00:00Z',
    };
  };
  const roastResource = (roast: StoredRoast) => ({
    roast_id: roast.roast_id,
    coffee_id: roast.coffee_id,
    coffee_name: 'Ethiopia Guji',
    batch_id: roast.batch_id,
    batch_name: batches.find((batch) => batch.id === roast.batch_id)?.name ?? null,
    roast_date: roast.roast_date,
    events: [],
  });
  const openBatch = (name: string, batchDate: string) => {
    const batch = {
      id: `${String(nextBatch).repeat(8)}-0000-4000-8000-000000000000`,
      name,
      batch_date: batchDate,
    };
    nextBatch += 1;
    batches.push(batch);
    return batch;
  };
  const placeRoast = (body: {
    coffeeId: number;
    batchId?: string;
    batchName?: string;
    roastDate?: string;
  }) => {
    const roastDate = body.roastDate ?? '2026-10-07';
    let batch: StoredBatch | undefined;
    if (body.batchId !== undefined) {
      batch = batches.find((candidate) => candidate.id === body.batchId);
      if (!batch) return null;
    } else {
      const name = body.batchName ?? `Ethiopia Guji - ${roastDate}`;
      batch =
        batches.find(
          (candidate) => candidate.name === name && candidate.batch_date === roastDate
        ) ?? openBatch(name, roastDate);
    }
    const roast = {
      roast_id: nextRoast++,
      coffee_id: body.coffeeId,
      batch_id: batch.id,
      roast_date: roastDate,
    };
    roasts.push(roast);
    return roast;
  };

  const client = {
    roastBatches: {
      list: vi.fn(
        async (
          query: {
            name?: string;
            date_start?: string;
            date_end?: string;
            include_empty?: 'true' | 'false';
            limit?: number;
            offset?: number;
          } = {}
        ) => {
          const rows = batches
            .map(resource)
            .filter((batch) => query.include_empty === 'true' || batch.roast_count > 0)
            .filter((batch) => query.name === undefined || batch.name === query.name)
            .filter((batch) => !query.date_start || batch.batch_date >= query.date_start)
            .filter((batch) => !query.date_end || batch.batch_date <= query.date_end)
            .sort((a, b) => b.batch_date.localeCompare(a.batch_date));
          const offset = query.offset ?? 0;
          return ok({ data: rows.slice(offset, offset + (query.limit ?? 20)) });
        }
      ),
      get: vi.fn(async (batchId: string) => {
        const batch = batches.find((candidate) => candidate.id === batchId);
        return batch ? ok({ data: resource(batch) }) : notFound('Roast batch not found');
      }),
      create: vi.fn(async (body: { name: string; batchDate?: string }, _key: string) => {
        const batch = openBatch(body.name, body.batchDate ?? '2026-10-07');
        return ok({ data: { batch: resource(batch), profiles: [] } }, 201);
      }),
      update: vi.fn(async (batchId: string, body: { name?: string; batchDate?: string }) => {
        const batch = batches.find((candidate) => candidate.id === batchId);
        if (!batch) return notFound('Roast batch not found');
        if (body.name !== undefined) batch.name = body.name;
        if (body.batchDate !== undefined) batch.batch_date = body.batchDate;
        return ok({ data: resource(batch) });
      }),
      delete: vi.fn(async (batchId: string) => {
        const index = batches.findIndex((candidate) => candidate.id === batchId);
        if (index === -1) return notFound('Roast batch not found');
        const [batch] = batches.splice(index, 1);
        const ids = members(batchId).map((roast) => roast.roast_id);
        for (const id of ids)
          roasts.splice(
            roasts.findIndex((roast) => roast.roast_id === id),
            1
          );
        return ok({ data: { id: batch.id, batchName: batch.name, ids, deleted: true as const } });
      }),
    },
    roasts: {
      list: vi.fn(async (query: { batch_id?: string }) =>
        ok({
          data: roasts
            .filter((roast) => query.batch_id === undefined || roast.batch_id === query.batch_id)
            .map(roastResource),
        })
      ),
      get: vi.fn(async (id: string) => {
        const roast = roasts.find((candidate) => String(candidate.roast_id) === id);
        return roast ? ok({ data: roastResource(roast) }) : notFound('Roast not found');
      }),
      create: vi.fn(async (body: { coffeeId: number; batchId?: string; batchName?: string }) => {
        const roast = placeRoast(body);
        return roast ? ok({ data: roastResource(roast) }, 201) : notFound('Roast batch not found');
      }),
      update: vi.fn(async (id: number, body: { batchId?: string }) => {
        const roast = roasts.find((candidate) => candidate.roast_id === id);
        if (!roast) return notFound('Roast not found');
        if (body.batchId !== undefined) roast.batch_id = body.batchId;
        return ok({ data: roastResource(roast) });
      }),
      import: vi.fn(async (body: { coffeeId: number; batchId?: string; batchName?: string }) => {
        const roast = placeRoast(body);
        if (!roast) return notFound('Roast batch not found');
        return ok(
          {
            data: {
              roast: roastResource(roast),
              import: { temperaturePoints: 12, milestoneEvents: 2, controlEvents: 0 },
            },
          },
          201
        );
      }),
    },
    sales: {
      list: vi.fn(async () => ok({ data: [{ id: 3, batch_id: LAST_WEEK, roast_id: null }] })),
    },
  };

  vi.mocked(createParchmentClient).mockResolvedValue(client as never);

  return {
    client,
    batches,
    roasts,
    /** Add a batch that already exists on the account, with roasts of inventory item 7. */
    seed(id: string, name: string, batchDate: string, roastIds: number[]) {
      batches.push({ id, name, batch_date: batchDate });
      for (const roastId of roastIds) {
        roasts.push({ roast_id: roastId, coffee_id: 7, batch_id: id, roast_date: batchDate });
      }
    },
  };
}

class ExitSignal extends Error {
  constructor(public readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

async function run(build: () => Command, ...args: string[]) {
  const command = build();
  command.exitOverride();
  await command.parseAsync(['node', command.name(), ...args]);
}

/** Run a command that is expected to fail, and return its machine-mode error envelope. */
async function runFailing(build: () => Command, ...args: string[]) {
  let stderr = '';
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitSignal(Number(code));
  });
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await run(build, ...args);
    throw new Error('expected the command to fail');
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
    return JSON.parse(stderr) as { code: string; exitCode: number; message: string };
  } finally {
    exit.mockRestore();
    write.mockRestore();
  }
}

const lastOutput = () => vi.mocked(outputData).mock.calls.at(-1)?.[0];

beforeEach(() => vi.clearAllMocks());

describe('roast-batch commands', () => {
  it('reports an account with no batches without printing data', async () => {
    fakeBatchApi();

    await run(buildRoastBatchCommand, 'list');

    expect(info).toHaveBeenCalledWith('No roast batches found.');
    expect(outputData).not.toHaveBeenCalled();
  });

  it('lists batches that share a name as separate batches with their own IDs', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);
    api.seed(THIS_WEEK, 'wednesday', '2026-10-07', [51]);

    await run(buildRoastBatchCommand, 'list', '--name', 'wednesday');

    expect(api.client.roastBatches.list).toHaveBeenCalledWith({
      name: 'wednesday',
      date_start: undefined,
      date_end: undefined,
      limit: 20,
      offset: 0,
    });
    expect(lastOutput()).toEqual([
      expect.objectContaining({ id: THIS_WEEK, batch_date: '2026-10-07', roast_ids: [51] }),
      expect.objectContaining({ id: LAST_WEEK, batch_date: '2026-09-30', roast_ids: [41, 42] }),
    ]);
  });

  it('maps the date range, paging, and empty-batch flags', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await run(
      buildRoastBatchCommand,
      'list',
      '--date-start',
      '2026-09-01',
      '--date-end',
      '2026-09-30',
      '--include-empty',
      '--limit',
      '200',
      '--offset',
      '0'
    );

    expect(api.client.roastBatches.list).toHaveBeenCalledWith({
      name: undefined,
      date_start: '2026-09-01',
      date_end: '2026-09-30',
      include_empty: 'true',
      limit: 200,
      offset: 0,
    });
  });

  it('refuses a page size or date the batch list does not accept, before any request', async () => {
    const api = fakeBatchApi();

    await expect(runFailing(buildRoastBatchCommand, 'list', '--limit', '201')).resolves.toEqual(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
        message: 'Invalid --limit: "201". Must be an integer between 1 and 200.',
      })
    );
    await expect(
      runFailing(buildRoastBatchCommand, 'list', '--date-start', 'last week')
    ).resolves.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'Invalid --date-start: "last week". Must be YYYY-MM-DD format.',
    });
    expect(api.client.roastBatches.list).not.toHaveBeenCalled();
  });

  it('opens an empty batch that stays out of the default list until it holds a roast', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await run(buildRoastBatchCommand, 'create', '--name', 'wednesday', '--date', '2026-10-07');

    expect(api.client.roastBatches.create).toHaveBeenCalledWith(
      { name: 'wednesday', batchDate: '2026-10-07' },
      expect.stringMatching(UUID)
    );
    const opened = lastOutput() as { id: string; roast_count: number };
    // Always a new batch: last week's batch with the same name is left alone.
    expect(opened.id).not.toBe(LAST_WEEK);
    expect(opened.roast_count).toBe(0);
    expect(success).toHaveBeenCalledWith(`Roast batch ${opened.id} opened.`);

    await run(buildRoastBatchCommand, 'list');
    expect(lastOutput()).toEqual([expect.objectContaining({ id: LAST_WEEK })]);

    await run(buildRoastBatchCommand, 'list', '--include-empty');
    expect((lastOutput() as Array<{ id: string }>).map((batch) => batch.id)).toEqual([
      opened.id,
      LAST_WEEK,
    ]);
  });

  it("files a new batch under today's local date and reuses a supplied retry key", async () => {
    const api = fakeBatchApi();
    vi.useFakeTimers({ now: new Date(2026, 9, 7, 23, 30) });
    try {
      await run(
        buildRoastBatchCommand,
        'create',
        '--name',
        'late session',
        '--idempotency-key',
        'retry-1'
      );
    } finally {
      vi.useRealTimers();
    }

    expect(api.client.roastBatches.create).toHaveBeenCalledWith(
      { name: 'late session', batchDate: '2026-10-07' },
      'retry-1'
    );
  });

  it('gets one batch by ID', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);

    await run(buildRoastBatchCommand, 'get', LAST_WEEK);

    expect(lastOutput()).toMatchObject({
      id: LAST_WEEK,
      name: 'wednesday',
      roast_count: 2,
      roast_ids: [41, 42],
      coffee_ids: [7],
    });
  });

  it('refuses a batch name where a batch ID is expected, before any request', async () => {
    const api = fakeBatchApi();

    await expect(runFailing(buildRoastBatchCommand, 'get', 'wednesday')).resolves.toMatchObject({
      code: 'INVALID_ARGUMENT',
      exitCode: 2,
      message:
        "Invalid batch ID: expected a batch ID (UUID). Find one with 'purvey roast-batch list'.",
    });
    expect(api.client.roastBatches.get).not.toHaveBeenCalled();
  });

  it('reports a batch that does not exist as not found', async () => {
    fakeBatchApi();

    await expect(runFailing(buildRoastBatchCommand, 'get', LAST_WEEK)).resolves.toMatchObject({
      code: 'NOT_FOUND',
      exitCode: 4,
      message: 'Roast batch not found',
    });
  });

  it('renames or re-dates one batch and leaves a same-named batch alone', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);
    api.seed(THIS_WEEK, 'wednesday', '2026-10-07', [51]);

    await run(buildRoastBatchCommand, 'update', THIS_WEEK, '--name', 'wednesday decaf');
    expect(api.client.roastBatches.update).toHaveBeenLastCalledWith(THIS_WEEK, {
      name: 'wednesday decaf',
      batchDate: undefined,
    });
    expect(lastOutput()).toMatchObject({ id: THIS_WEEK, name: 'wednesday decaf' });
    expect(api.batches.find((batch) => batch.id === LAST_WEEK)?.name).toBe('wednesday');

    await run(buildRoastBatchCommand, 'update', THIS_WEEK, '--date', '2026-10-08');
    expect(lastOutput()).toMatchObject({ id: THIS_WEEK, batch_date: '2026-10-08' });
  });

  it('refuses an update with nothing to change', async () => {
    const api = fakeBatchApi();

    await expect(runFailing(buildRoastBatchCommand, 'update', THIS_WEEK)).resolves.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'No update fields provided. Pass at least one of: --name, --date.',
    });
    expect(api.client.roastBatches.update).not.toHaveBeenCalled();
  });

  it('deletes one batch and its roasts by ID, and no other batch with the same name', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);
    api.seed(THIS_WEEK, 'wednesday', '2026-10-07', [51]);

    await run(buildRoastBatchCommand, 'delete', LAST_WEEK, '--yes');

    expect(confirm).not.toHaveBeenCalled();
    expect(api.client.roastBatches.delete).toHaveBeenCalledWith(LAST_WEEK);
    expect(lastOutput()).toEqual({
      id: LAST_WEEK,
      batchName: 'wednesday',
      ids: [41, 42],
      deleted: true,
    });
    expect(success).toHaveBeenCalledWith(`Roast batch ${LAST_WEEK} deleted with 2 roasts.`);
    expect(api.batches.map((batch) => batch.id)).toEqual([THIS_WEEK]);
    expect(api.roasts.map((roast) => roast.roast_id)).toEqual([51]);
  });

  it('asks before deleting and names how many roasts go with the batch', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await run(buildRoastBatchCommand, 'delete', LAST_WEEK);

    expect(confirm).toHaveBeenCalledWith(
      'Delete roast batch "wednesday" (2026-09-30)? Its 2 roasts will be deleted too.'
    );
    expect(info).toHaveBeenCalledWith('Aborted.');
    expect(api.client.roastBatches.delete).not.toHaveBeenCalled();
    expect(api.roasts).toHaveLength(2);

    vi.mocked(confirm).mockResolvedValueOnce(true);
    await run(buildRoastBatchCommand, 'delete', LAST_WEEK);
    expect(api.client.roastBatches.delete).toHaveBeenCalledWith(LAST_WEEK);
  });
});

describe('roast commands with batch IDs', () => {
  let workDir: string;
  let alogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'purvey-roast-batch-'));
    alogPath = join(workDir, 'roast.alog');
    await writeFile(alogPath, "{'title': 'Test'}");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('filters the roast list by batch ID and shows the batch ID on every roast', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);
    api.seed(THIS_WEEK, 'wednesday', '2026-10-07', [51]);

    await run(buildRoastCommand, 'list', '--batch-id', THIS_WEEK);

    expect(api.client.roasts.list).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: THIS_WEEK })
    );
    expect(lastOutput()).toEqual([
      expect.objectContaining({ roast_id: 51, batch_id: THIS_WEEK, batch_name: 'wednesday' }),
    ]);
  });

  it('creates a roast in an existing batch by ID, whatever the roast date', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await run(
      buildRoastCommand,
      'create',
      '--coffee-id',
      '7',
      '--batch-id',
      LAST_WEEK,
      '--roast-date',
      '2026-10-01'
    );

    const [body] = api.client.roasts.create.mock.calls[0];
    expect(body).toMatchObject({ coffeeId: 7, batchId: LAST_WEEK, roastDate: '2026-10-01' });
    expect(body).not.toHaveProperty('batchName');
    expect(lastOutput()).toMatchObject({ batch_id: LAST_WEEK, batch_name: 'wednesday' });
    expect(success).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^Roast profile \\d+ created in batch ${LAST_WEEK}\\.$`))
    );
  });

  it('places a roast written with only a name by name and roast date', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await run(
      buildRoastCommand,
      'create',
      '--coffee-id',
      '7',
      '--batch-name',
      'wednesday',
      '--roast-date',
      '2026-10-07'
    );

    const [body] = api.client.roasts.create.mock.calls[0];
    expect(body).toMatchObject({ batchName: 'wednesday' });
    expect(body).not.toHaveProperty('batchId');
    // A different date under the same name is a different batch.
    expect((lastOutput() as { batch_id: string }).batch_id).not.toBe(LAST_WEEK);
  });

  it('imports an Artisan file into a batch by ID and prints the batch ID', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await run(buildRoastCommand, 'import', alogPath, '--coffee-id', '7', '--batch-id', LAST_WEEK);

    const [body] = api.client.roasts.import.mock.calls[0];
    expect(body).toMatchObject({ coffeeId: 7, batchId: LAST_WEEK, fileName: 'roast.alog' });
    expect(body).not.toHaveProperty('batchName');
    expect(lastOutput()).toMatchObject({ batch_id: LAST_WEEK, batch_name: 'wednesday' });
    expect(success).toHaveBeenCalledWith(
      expect.stringContaining(`imported from roast.alog into batch ${LAST_WEEK}.`)
    );
  });

  it('returns the batch ID of a roast imported by name, so the next file can join it', async () => {
    const api = fakeBatchApi();

    await run(buildRoastCommand, 'import', alogPath, '--coffee-id', '7', '--batch-name', 'friday');
    const first = lastOutput() as { batch_id: string };
    expect(first.batch_id).toMatch(UUID);

    await run(
      buildRoastCommand,
      'import',
      alogPath,
      '--coffee-id',
      '7',
      '--batch-id',
      first.batch_id
    );
    expect(lastOutput()).toMatchObject({ batch_id: first.batch_id });
    expect(api.batches).toHaveLength(1);
    expect(api.roasts.map((roast) => roast.batch_id)).toEqual([first.batch_id, first.batch_id]);
  });

  it('moves a roast into another batch by ID', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);
    api.seed(THIS_WEEK, 'wednesday', '2026-10-07', [51]);

    await run(buildRoastCommand, 'update', '51', '--batch-id', LAST_WEEK);

    expect(api.client.roasts.update).toHaveBeenCalledWith(51, { batchId: LAST_WEEK });
    expect(lastOutput()).toMatchObject({ roast_id: 51, batch_id: LAST_WEEK });
  });

  it.each([
    ['create', () => ['create', '--coffee-id', '7']],
    ['import', (file: string) => ['import', file, '--coffee-id', '7']],
    ['update', () => ['update', '51']],
    ['from-reference', () => ['from-reference', LAST_WEEK, THIS_WEEK, '--coffee-id', '7']],
  ])(
    'roast %s refuses --batch-id with --batch-name, and a batch ID that is not a UUID',
    async (_name, args) => {
      const api = fakeBatchApi();
      const base = args(alogPath);

      await expect(
        runFailing(buildRoastCommand, ...base, '--batch-id', LAST_WEEK, '--batch-name', 'wednesday')
      ).resolves.toMatchObject({
        code: 'INVALID_ARGUMENT',
        exitCode: 2,
        message: expect.stringContaining('Use either --batch-id or --batch-name, not both.'),
      });
      await expect(
        runFailing(buildRoastCommand, ...base, '--batch-id', 'wednesday')
      ).resolves.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('Invalid --batch-id: expected a batch ID (UUID).'),
      });
      expect(api.client.roasts.create).not.toHaveBeenCalled();
      expect(api.client.roasts.import).not.toHaveBeenCalled();
      expect(api.client.roasts.update).not.toHaveBeenCalled();
    }
  );

  it('filters sales by batch ID and by roast ID', async () => {
    const api = fakeBatchApi();

    await run(buildSalesCommand, 'list', '--batch-id', LAST_WEEK, '--roast-id', '41');

    expect(api.client.sales.list).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: LAST_WEEK, roast_id: 41 })
    );
    expect(lastOutput()).toEqual([{ id: 3, batch_id: LAST_WEEK, roast_id: null }]);
  });
});

describe('roast batch library', () => {
  it('validates batch IDs and batch selectors', () => {
    expect(parseRoastBatchId(LAST_WEEK, 'batch ID')).toBe(LAST_WEEK);
    expect(() => parseRoastBatchId('wednesday', '--batch-id')).toThrow(
      'Invalid --batch-id: expected a batch ID (UUID).'
    );
    expect(listRoastsSchema.parse({ batch_id: LAST_WEEK }).batch_id).toBe(LAST_WEEK);
    expect(() => listRoastsSchema.parse({ batch_id: 'wednesday' })).toThrow();

    const both = { batchId: LAST_WEEK, batchName: 'wednesday' };
    expect(createRoastSchema.safeParse({ coffeeId: 7, ...both }).success).toBe(false);
    expect(createRoastSchema.safeParse({ coffeeId: 7, batchId: LAST_WEEK }).success).toBe(true);
    expect(updateRoastSchema.safeParse(both).success).toBe(false);
    expect(updateRoastSchema.safeParse({ batchId: LAST_WEEK }).success).toBe(true);
    expect(
      importRoastSchema.safeParse({ fileContent: '{}', fileName: 'r.alog', coffeeId: 7, ...both })
        .success
    ).toBe(false);
  });

  it('checks a batch name without trimming it', async () => {
    const api = fakeBatchApi();

    await expect(createRoastBatch({ name: '   ' })).rejects.toThrow('Batch name cannot be blank');
    await expect(createRoastBatch({ name: 'x'.repeat(256) })).rejects.toThrow(
      'Batch name must be at most 255 characters'
    );
    await expect(updateRoastBatch(LAST_WEEK, {})).rejects.toThrow('No update fields provided');
    expect(api.client.roastBatches.create).not.toHaveBeenCalled();

    await createRoastBatch({ name: ' wednesday ' });
    expect(api.client.roastBatches.create).toHaveBeenCalledWith(
      { name: ' wednesday ' },
      expect.stringMatching(UUID)
    );
  });

  it('pins a token override on every batch call and maps API errors', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41]);

    await listRoastBatches({}, 'pinned');
    await getRoastBatch(LAST_WEEK, 'pinned');
    await updateRoastBatch(LAST_WEEK, { name: 'renamed' }, 'pinned');
    await createRoastBatch({ name: 'new' }, { tokenOverride: 'pinned' });
    await deleteRoastBatch(LAST_WEEK, 'pinned');

    expect(vi.mocked(createParchmentClient).mock.calls).toEqual(
      Array.from({ length: 5 }, () => ['member', 'pinned'])
    );
    await expect(deleteRoastBatch(LAST_WEEK)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Roast batch not found',
    });
  });
});

describe('watch session batch access', () => {
  const session = (apiKey: string | null) => ({
    getSession: vi.fn().mockResolvedValue({ data: { session: apiKey ? { apiKey } : null } }),
  });

  it('saves a watched roast by batch ID and sends the name only without one', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', []);
    const importer = createWatchRoastImporter(session('session-key') as never);
    const file = { fileContent: '{}', fileName: 'r.alog', coffeeId: 7 };

    const joined = await importer({ ...file, batchName: 'wednesday', batchId: LAST_WEEK });
    const [byId] = api.client.roasts.import.mock.calls[0];
    expect(byId).toMatchObject({ batchId: LAST_WEEK });
    expect(byId).not.toHaveProperty('batchName');
    expect(joined.batch_id).toBe(LAST_WEEK);

    const own = await importer({ ...file, batchName: 'wednesday #2' });
    const [byName] = api.client.roasts.import.mock.calls[1];
    expect(byName).toMatchObject({ batchName: 'wednesday #2' });
    expect(byName).not.toHaveProperty('batchId');
    expect(own.batch_id).not.toBe(LAST_WEEK);
  });

  it('opens, reads, and removes the session batch as the signed-in user', async () => {
    const api = fakeBatchApi();
    api.seed(LAST_WEEK, 'wednesday', '2026-09-30', [41, 42]);
    const store = createWatchBatchStore(session('session-key') as never);

    const opened = await store.create({ name: 'wednesday', batchDate: '2026-10-07' });
    expect(api.client.roastBatches.create).toHaveBeenCalledWith(
      { name: 'wednesday', batchDate: '2026-10-07' },
      expect.stringMatching(UUID)
    );
    expect(opened).toMatchObject({ batchDate: '2026-10-07', roastIds: [] });
    expect(opened.id).not.toBe(LAST_WEEK);

    await expect(store.get(LAST_WEEK)).resolves.toEqual({
      id: LAST_WEEK,
      name: 'wednesday',
      batchDate: '2026-09-30',
      roastIds: [41, 42],
    });
    await expect(store.batchIdForRoast(41)).resolves.toBe(LAST_WEEK);
    // A batch or roast that is gone is an answer, not a failure.
    await expect(store.get(THIS_WEEK)).resolves.toBeNull();
    await expect(store.batchIdForRoast(999)).resolves.toBeNull();

    await store.delete(opened.id);
    expect(api.client.roastBatches.delete).toHaveBeenCalledWith(opened.id);
    expect(
      vi.mocked(createParchmentClient).mock.calls.every(([, key]) => key === 'session-key')
    ).toBe(true);
  });

  it('refuses to touch a batch once the session has expired', async () => {
    const api = fakeBatchApi();
    const store = createWatchBatchStore(session(null) as never);

    await expect(
      store.create({ name: 'wednesday', batchDate: '2026-10-07' })
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    await expect(store.delete(LAST_WEEK)).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(api.client.roastBatches.create).not.toHaveBeenCalled();
    expect(api.client.roastBatches.delete).not.toHaveBeenCalled();
  });
});
