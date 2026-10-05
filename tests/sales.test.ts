import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});

import { createParchmentClient } from '../src/lib/parchment.js';
import {
  SALE_SELECT,
  deleteSale,
  deleteSaleSchema,
  listSalesSchema,
  recordSale,
  recordSaleSchema,
  resolveSaleRoast,
  saleTargetSelectorSchema,
  updateSale,
  updateSaleSchema,
} from '../src/lib/sales.js';
import type { ResolvedSaleTarget, Sale } from '../src/lib/sales.js';
import { PrvrsError } from '../src/lib/errors.js';

const ok = <T>(data: T, status = 200) => ({ data, response: new Response(null, { status }) });

describe('sales schemas', () => {
  it('preserves the 0.27 public sales exports and type shapes', () => {
    const target: ResolvedSaleTarget = { roastId: 42, mode: 'exact' };
    const sale = { last_updated: '2026-07-12T00:00:00Z' } as Sale;

    expect(SALE_SELECT).toContain('last_updated');
    expect(target.roastId).toBe(42);
    expect(sale.last_updated).toBe('2026-07-12T00:00:00Z');
  });

  it('validates list pagination and filters', () => {
    expect(listSalesSchema.parse({}).limit).toBe(20);
    expect(listSalesSchema.parse({ greenCoffeeInvId: 42, offset: 0 }).greenCoffeeInvId).toBe(42);
    expect(
      listSalesSchema.parse({ batchId: '11111111-1111-4111-8111-111111111111', roastId: 3 }).roastId
    ).toBe(3);
    expect(() => listSalesSchema.parse({ batchId: 'wednesday' })).toThrow();
    expect(() => listSalesSchema.parse({ limit: 0 })).toThrow();
    expect(() => listSalesSchema.parse({ offset: -1 })).toThrow();
  });

  it('requires exactly one complete selector mode', () => {
    const batchId = '11111111-1111-4111-8111-111111111111';
    expect(saleTargetSelectorSchema.parse({ roastId: 42 }).roastId).toBe(42);
    expect(saleTargetSelectorSchema.parse({ coffeeId: 7, batchName: 'Batch A' }).coffeeId).toBe(7);
    expect(saleTargetSelectorSchema.parse({ batchId }).batchId).toBe(batchId);
    expect(saleTargetSelectorSchema.parse({ batchId, coffeeId: 7 }).coffeeId).toBe(7);
    expect(saleTargetSelectorSchema.parse({ batchId, roastId: 42 }).roastId).toBe(42);
    expect(() => saleTargetSelectorSchema.parse({})).toThrow();
    expect(() => saleTargetSelectorSchema.parse({ coffeeId: 7 })).toThrow();
    expect(() =>
      saleTargetSelectorSchema.parse({ roastId: 42, coffeeId: 7, batchName: 'A' })
    ).toThrow();
    expect(() => saleTargetSelectorSchema.parse({ batchId, batchName: 'A' })).toThrow();
    expect(() => saleTargetSelectorSchema.parse({ batchId: 'wednesday' })).toThrow();
  });

  it('validates create, update, and delete inputs', () => {
    expect(recordSaleSchema.parse({ roastId: 42, oz: 12, price: 0 }).price).toBe(0);
    expect(() => recordSaleSchema.parse({ roastId: 42, oz: 0, price: 1 })).toThrow();
    expect(updateSaleSchema.parse({ buyer: '' }).buyer).toBe('');
    expect(() => updateSaleSchema.parse({})).toThrow();
    expect(deleteSaleSchema.parse({ id: 1 }).id).toBe(1);
    expect(() => deleteSaleSchema.parse({ id: 0 })).toThrow();
  });
});

const BATCH_A = '11111111-1111-4111-8111-111111111111';
const BATCH_B = '22222222-2222-4222-8222-222222222222';
const BATCH_C = '33333333-3333-4333-8333-333333333333';

interface FakeRoast {
  roast_id: number;
  coffee_id: number | null;
  batch_id: string;
  batch_name: string | null;
}

interface FakeBatch {
  id: string;
  name: string;
  batch_date: string;
}

/**
 * In-memory stand-in for the roast, batch, and sale endpoints the selector
 * reads. `roasts.list` filters the way the API does: `batch_id` and `coffee_id`
 * exactly, `batch_name` as a partial case-insensitive match.
 */
function fakeSalesApi(roasts: FakeRoast[], batches: FakeBatch[], pageCap = 100) {
  const list = vi.fn(
    async (query: {
      coffee_id?: number;
      batch_id?: string;
      batch_name?: string;
      limit: number;
      offset: number;
    }) => {
      const rows = roasts
        .filter((row) => query.coffee_id === undefined || row.coffee_id === query.coffee_id)
        .filter((row) => query.batch_id === undefined || row.batch_id === query.batch_id)
        .filter(
          (row) =>
            query.batch_name === undefined ||
            (row.batch_name ?? '').toLowerCase().includes(query.batch_name.toLowerCase())
        );
      return ok({ data: rows.slice(query.offset, query.offset + Math.min(query.limit, pageCap)) });
    }
  );
  const get = vi.fn(async (id: string) => {
    const roast = roasts.find((row) => String(row.roast_id) === id);
    return roast
      ? ok({ data: roast })
      : {
          error: { error: { message: 'Roast not found' } },
          response: new Response(null, { status: 404 }),
        };
  });
  const getBatch = vi.fn(async (id: string) => {
    const batch = batches.find((row) => row.id === id);
    if (!batch) {
      return {
        error: { error: { message: 'Roast batch not found' } },
        response: new Response(null, { status: 404 }),
      };
    }
    const members = roasts.filter((row) => row.batch_id === id);
    return ok({
      data: {
        ...batch,
        roast_count: members.length,
        roast_ids: members.map((row) => row.roast_id),
        coffee_ids: [...new Set(members.flatMap((row) => (row.coffee_id ? [row.coffee_id] : [])))],
      },
    });
  });
  const create = vi.fn(async (body: Record<string, unknown>) =>
    ok({ data: { id: 9, ...body } }, 201)
  );

  vi.mocked(createParchmentClient).mockResolvedValue({
    roasts: { get, list },
    roastBatches: { get: getBatch },
    sales: { create },
  } as never);

  return { list, get, getBatch, create };
}

/** Two weeks of a reused "wednesday" batch name, plus one other batch. */
function weeklyWednesdays() {
  return fakeSalesApi(
    [
      { roast_id: 41, coffee_id: 7, batch_id: BATCH_A, batch_name: 'wednesday' },
      { roast_id: 42, coffee_id: 7, batch_id: BATCH_A, batch_name: 'wednesday' },
      { roast_id: 43, coffee_id: 9, batch_id: BATCH_A, batch_name: 'wednesday' },
      { roast_id: 51, coffee_id: 7, batch_id: BATCH_B, batch_name: 'wednesday' },
      { roast_id: 52, coffee_id: 8, batch_id: BATCH_B, batch_name: 'wednesday' },
      { roast_id: 61, coffee_id: 7, batch_id: BATCH_C, batch_name: 'wednesday decaf' },
    ],
    [
      { id: BATCH_A, name: 'wednesday', batch_date: '2026-09-30' },
      { id: BATCH_B, name: 'wednesday', batch_date: '2026-10-07' },
      { id: BATCH_C, name: 'wednesday decaf', batch_date: '2026-10-07' },
    ]
  );
}

describe('SDK-backed sales writes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves an exact roast through get and pins the token', async () => {
    const { get } = fakeSalesApi(
      [{ roast_id: 42, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' }],
      [{ id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' }]
    );
    await expect(resolveSaleRoast({ roastId: 42 }, 'pinned')).resolves.toEqual({
      greenCoffeeInvId: 7,
      batchId: BATCH_A,
      batchName: 'Batch A',
      roastId: 42,
      batchRoastIds: [42],
      mode: 'exact',
    });
    expect(createParchmentClient).toHaveBeenCalledWith('member', 'pinned');
    expect(get).toHaveBeenCalledWith('42');
  });

  it('reports the roasts of the same batch, not every roast that shares the name', async () => {
    const { list } = weeklyWednesdays();

    await expect(resolveSaleRoast({ roastId: 42 })).resolves.toEqual({
      greenCoffeeInvId: 7,
      batchId: BATCH_A,
      batchName: 'wednesday',
      roastId: 42,
      batchRoastIds: [41, 42],
      mode: 'exact',
    });
    expect(list).toHaveBeenCalledWith({ coffee_id: 7, batch_id: BATCH_A, limit: 100, offset: 0 });
    expect(list).not.toHaveBeenCalledWith(expect.objectContaining({ batch_name: 'wednesday' }));
  });

  it('records a sale by roast ID against that roast and its batch', async () => {
    const { create } = weeklyWednesdays();

    await expect(recordSale({ roastId: 42, oz: 12, price: 22 })).resolves.toMatchObject({ id: 9 });
    expect(create).toHaveBeenCalledWith(
      { greenCoffeeInvId: 7, ozSold: 12, price: 22, batchId: BATCH_A, roastId: 42 },
      { idempotencyKey: expect.any(String) }
    );
  });

  it('refuses a roast paired with a batch it is not in', async () => {
    const { create } = weeklyWednesdays();

    await expect(
      recordSale({ roastId: 42, batchId: BATCH_B, oz: 12, price: 22 })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining(`is in batch ${BATCH_A}, not ${BATCH_B}`),
    });
    await expect(resolveSaleRoast({ roastId: 42, batchId: BATCH_A })).resolves.toMatchObject({
      batchId: BATCH_A,
      roastId: 42,
      mode: 'exact',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an exact roast with no inventory link', async () => {
    fakeSalesApi(
      [{ roast_id: 42, coffee_id: null, batch_id: BATCH_A, batch_name: null }],
      [{ id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' }]
    );
    await expect(resolveSaleRoast({ roastId: 42 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('records a sale by batch ID against the batch as a whole, naming no roast', async () => {
    const { create } = weeklyWednesdays();

    await expect(resolveSaleRoast({ batchId: BATCH_B, coffeeId: 7 })).resolves.toEqual({
      greenCoffeeInvId: 7,
      batchId: BATCH_B,
      batchName: 'wednesday',
      roastId: 51,
      batchRoastIds: [51],
      mode: 'batch',
    });
    await recordSale({ batchId: BATCH_A, coffeeId: 7, oz: 8, price: 16, buyer: 'Ada' });
    expect(create).toHaveBeenCalledWith(
      { greenCoffeeInvId: 7, ozSold: 8, price: 16, buyer: 'Ada', batchId: BATCH_A },
      { idempotencyKey: expect.any(String) }
    );
  });

  it('reads the coffee from a batch that holds only one', async () => {
    weeklyWednesdays();

    await expect(resolveSaleRoast({ batchId: BATCH_C })).resolves.toMatchObject({
      greenCoffeeInvId: 7,
      batchId: BATCH_C,
      batchRoastIds: [61],
      mode: 'batch',
    });
  });

  it('asks which coffee was sold when a batch holds more than one', async () => {
    weeklyWednesdays();

    await expect(resolveSaleRoast({ batchId: BATCH_A })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: `Batch ${BATCH_A} (2026-09-30) holds roasts of more than one inventory item: 7, 9. Pass --coffee-id to say which one was sold.`,
    });
  });

  it('refuses a batch that holds no roast of the coffee, an empty batch, and an unknown batch', async () => {
    fakeSalesApi(
      [{ roast_id: 41, coffee_id: 7, batch_id: BATCH_A, batch_name: 'wednesday' }],
      [
        { id: BATCH_A, name: 'wednesday', batch_date: '2026-09-30' },
        { id: BATCH_B, name: 'Roast batch - 2026-10-07', batch_date: '2026-10-07' },
      ]
    );

    await expect(resolveSaleRoast({ batchId: BATCH_A, coffeeId: 8 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: `Batch ${BATCH_A} (2026-09-30) holds no roast of --coffee-id 8. It holds roasts of: 7.`,
    });
    await expect(resolveSaleRoast({ batchId: BATCH_B })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: `Batch ${BATCH_B} (2026-10-07) holds no roasts, so there is nothing to sell from it.`,
    });
    await expect(resolveSaleRoast({ batchId: BATCH_C })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Roast batch not found',
    });
  });

  it('refuses a batch name that matches more than one batch and lists each batch ID and date', async () => {
    const { create } = weeklyWednesdays();

    const attempt = recordSale({ coffeeId: 7, batchName: 'wednesday', oz: 12, price: 22 });
    await expect(attempt).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: {
        code: 'batch_name_ambiguous',
        candidates: [
          { batchId: BATCH_B, batchDate: '2026-10-07', roastIds: [51] },
          { batchId: BATCH_A, batchDate: '2026-09-30', roastIds: [41, 42] },
        ],
      },
    });
    await expect(attempt).rejects.toThrow(
      [
        'Batch name "wednesday" matches 2 batches with roasts of --coffee-id 7. Choose one by batch ID and run the command again with --batch-id in place of --batch-name:',
        `  --batch-id ${BATCH_B}   2026-10-07, roast 51`,
        `  --batch-id ${BATCH_A}   2026-09-30, roasts 41, 42`,
      ].join('\n')
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('resolves a repeated batch name when only one of its batches holds the coffee', async () => {
    const { create } = weeklyWednesdays();

    await expect(resolveSaleRoast({ coffeeId: 9, batchName: 'wednesday' })).resolves.toEqual({
      greenCoffeeInvId: 9,
      batchId: BATCH_A,
      batchName: 'wednesday',
      roastId: 43,
      batchRoastIds: [43],
      mode: 'resolved',
    });
    await recordSale({ coffeeId: 8, batchName: 'wednesday', oz: 4, price: 9 });
    expect(create).toHaveBeenCalledWith(
      { greenCoffeeInvId: 8, ozSold: 4, price: 9, batchId: BATCH_B },
      { idempotencyKey: expect.any(String) }
    );
  });

  it('reports a named batch from its record, including roasts the name search does not return', async () => {
    // Roast 42 is in the batch but reads under a different name, as a roast of a
    // coffee with a private catalog entry does.
    fakeSalesApi(
      [
        { roast_id: 41, coffee_id: 7, batch_id: BATCH_A, batch_name: 'wednesday' },
        { roast_id: 42, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Roast batch - 2026-09-30' },
      ],
      [{ id: BATCH_A, name: 'wednesday', batch_date: '2026-09-30' }]
    );

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'wednesday' })).resolves.toMatchObject({
      batchId: BATCH_A,
      batchRoastIds: [41, 42],
      mode: 'resolved',
    });
  });

  it('post-filters partial batch matches and resolves one exact match', async () => {
    const { list } = fakeSalesApi(
      [
        { roast_id: 1, coffee_id: 7, batch_id: BATCH_B, batch_name: 'Batch A extra' },
        { roast_id: 2, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
        { roast_id: 3, coffee_id: 8, batch_id: BATCH_A, batch_name: 'Batch A' },
      ],
      [
        { id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' },
        { id: BATCH_B, name: 'Batch A extra', batch_date: '2026-07-12' },
      ]
    );
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toMatchObject({
      batchId: BATCH_A,
      roastId: 2,
      batchRoastIds: [2],
      mode: 'resolved',
    });
    expect(list).toHaveBeenCalledWith({
      coffee_id: 7,
      batch_name: 'Batch A',
      limit: 100,
      offset: 0,
    });
  });

  it('keeps the zero-match error and resolves a shared batch after exact post-filtering', async () => {
    fakeSalesApi(
      [{ roast_id: 1, coffee_id: 7, batch_id: BATCH_B, batch_name: 'Batch A extra' }],
      [{ id: BATCH_B, name: 'Batch A extra', batch_date: '2026-07-12' }]
    );
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    fakeSalesApi(
      [
        { roast_id: 3, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
        { roast_id: 2, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
        { roast_id: 4, coffee_id: 7, batch_id: BATCH_B, batch_name: 'Batch A extra' },
      ],
      [
        { id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' },
        { id: BATCH_B, name: 'Batch A extra', batch_date: '2026-07-12' },
      ]
    );
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toEqual({
      greenCoffeeInvId: 7,
      batchId: BATCH_A,
      batchName: 'Batch A',
      roastId: 2,
      batchRoastIds: [2, 3],
      mode: 'resolved',
    });
  });

  it('advances by capped page length and finds an exact match after a 25-row page', async () => {
    const { list } = fakeSalesApi(
      [
        ...Array.from({ length: 25 }, (_, index) => ({
          roast_id: index + 1,
          coffee_id: 7,
          batch_id: BATCH_B,
          batch_name: `Batch A partial ${index}`,
        })),
        { roast_id: 26, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
      ],
      [{ id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' }],
      25
    );

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toMatchObject({
      roastId: 26,
    });
    expect(list).toHaveBeenNthCalledWith(1, {
      coffee_id: 7,
      batch_name: 'Batch A',
      limit: 100,
      offset: 0,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      coffee_id: 7,
      batch_name: 'Batch A',
      limit: 100,
      offset: 25,
    });
    expect(list).toHaveBeenNthCalledWith(3, {
      coffee_id: 7,
      batch_name: 'Batch A',
      limit: 100,
      offset: 26,
    });
  });

  it('collects a shared batch whose second roast is on a later capped page', async () => {
    const { list } = fakeSalesApi(
      [
        { roast_id: 1, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
        ...Array.from({ length: 24 }, (_, index) => ({
          roast_id: index + 2,
          coffee_id: 7,
          batch_id: BATCH_B,
          batch_name: `Batch A partial ${index}`,
        })),
        { roast_id: 26, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' },
      ],
      [{ id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' }],
      25
    );

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toMatchObject({
      roastId: 1,
      batchRoastIds: [1, 26],
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 25 }));
    expect(list).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 26 }));
  });

  it('does not skip a later exact match after deduplicating overlapping pages', async () => {
    const exact = { roast_id: 1, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' };
    const later = { roast_id: 4, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' };
    const namePages = [
      [exact, { roast_id: 2, coffee_id: 7, batch_id: BATCH_B, batch_name: 'Batch A partial' }],
      [exact, { roast_id: 3, coffee_id: 7, batch_id: BATCH_C, batch_name: 'Batch A other' }],
      [later],
      [],
    ];
    const list = vi.fn(async (query: { batch_id?: string; offset: number }) =>
      query.batch_id === undefined
        ? ok({ data: namePages.shift() ?? [] })
        : ok({ data: query.offset === 0 ? [exact, later] : [] })
    );
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toMatchObject({
      batchRoastIds: [1, 4],
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 2 }));
    expect(list).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 3 }));
  });

  it('rejects a non-empty page containing no unseen roast IDs', async () => {
    const page = [{ roast_id: 1, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A partial' }];
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: page }))
      .mockResolvedValueOnce(ok({ data: page }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'GENERAL_ERROR',
      message: 'Sale roast selector pagination did not advance. Retry the request.',
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 1 }));
  });

  it('sends the canonical create payload with a fresh idempotency key and pinned identity', async () => {
    const { create } = fakeSalesApi(
      [{ roast_id: 42, coffee_id: 7, batch_id: BATCH_A, batch_name: 'Batch A' }],
      [{ id: BATCH_A, name: 'Batch A', batch_date: '2026-07-12' }]
    );
    create.mockResolvedValueOnce(ok({ data: { id: 55 } }, 201));
    await expect(
      recordSale(
        { roastId: 42, oz: 12, price: 18.5, buyer: 'Ada', sellDate: '2026-07-12' },
        'same-token'
      )
    ).resolves.toEqual({ id: 55 });
    expect(createParchmentClient).toHaveBeenNthCalledWith(1, 'member', 'same-token');
    expect(createParchmentClient).toHaveBeenNthCalledWith(2, 'member', 'same-token');
    expect(create).toHaveBeenCalledWith(
      {
        greenCoffeeInvId: 7,
        ozSold: 12,
        price: 18.5,
        buyer: 'Ada',
        batchId: BATCH_A,
        roastId: 42,
        sellDate: '2026-07-12',
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }
    );
  });

  it('maps update and delete to the SDK', async () => {
    const update = vi.fn().mockResolvedValue(ok({ data: { id: 5, price: 20 } }));
    const remove = vi.fn().mockResolvedValue(ok({ data: { id: 5, deleted: true } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      sales: { update, delete: remove },
    } as never);
    await expect(
      updateSale(5, { oz: 10, price: 20, buyer: 'B', sellDate: '2026-07-12' })
    ).resolves.toMatchObject({ id: 5 });
    expect(update).toHaveBeenCalledWith(5, {
      ozSold: 10,
      price: 20,
      buyer: 'B',
      sellDate: '2026-07-12',
    });
    await expect(deleteSale(5)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(5);
  });

  it('unwraps create API errors', async () => {
    const { create } = fakeSalesApi(
      [{ roast_id: 42, coffee_id: 7, batch_id: BATCH_A, batch_name: 'B' }],
      [{ id: BATCH_A, name: 'B', batch_date: '2026-07-12' }]
    );
    create.mockResolvedValueOnce({
      error: { error: { message: 'writes disabled' } },
      response: new Response(null, { status: 503 }),
    } as never);
    await expect(recordSale({ roastId: 42, oz: 1, price: 1 })).rejects.toEqual(
      expect.objectContaining<Partial<PrvrsError>>({
        code: 'GENERAL_ERROR',
        message: 'writes disabled',
      })
    );
  });

  it('unwraps update and delete API errors', async () => {
    const update = vi.fn().mockResolvedValue({
      error: { error: { message: 'sale missing' } },
      response: new Response(null, { status: 404 }),
    });
    const remove = vi.fn().mockResolvedValue({
      error: { error: { message: 'delete unavailable' } },
      response: new Response(null, { status: 503 }),
    });
    vi.mocked(createParchmentClient).mockResolvedValue({
      sales: { update, delete: remove },
    } as never);

    await expect(updateSale(5, { price: 20 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'sale missing',
    });
    await expect(deleteSale(5)).rejects.toMatchObject({
      code: 'GENERAL_ERROR',
      message: 'delete unavailable',
    });
  });
});
