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
    expect(() => listSalesSchema.parse({ limit: 0 })).toThrow();
    expect(() => listSalesSchema.parse({ offset: -1 })).toThrow();
  });

  it('requires exactly one complete selector mode', () => {
    expect(saleTargetSelectorSchema.parse({ roastId: 42 }).roastId).toBe(42);
    expect(saleTargetSelectorSchema.parse({ coffeeId: 7, batchName: 'Batch A' }).coffeeId).toBe(7);
    expect(() => saleTargetSelectorSchema.parse({})).toThrow();
    expect(() => saleTargetSelectorSchema.parse({ coffeeId: 7 })).toThrow();
    expect(() =>
      saleTargetSelectorSchema.parse({ roastId: 42, coffeeId: 7, batchName: 'A' })
    ).toThrow();
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

describe('SDK-backed sales writes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves an exact roast through get and pins the token', async () => {
    const get = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast_id: 42, coffee_id: 7, batch_name: 'Batch A' } }));
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 42, coffee_id: 7, batch_name: 'Batch A' }] }))
      .mockResolvedValueOnce(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { get, list } } as never);
    await expect(resolveSaleRoast({ roastId: 42 }, 'pinned')).resolves.toEqual({
      greenCoffeeInvId: 7,
      batchName: 'Batch A',
      roastId: 42,
      mode: 'exact',
    });
    expect(createParchmentClient).toHaveBeenCalledWith('member', 'pinned');
    expect(get).toHaveBeenCalledWith('42');
  });

  it('rejects an exact roast when the sales contract cannot preserve its identity', async () => {
    const get = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast_id: 42, coffee_id: 7, batch_name: 'Batch A' } }));
    const list = vi.fn().mockResolvedValue(
      ok({
        data: [
          { roast_id: 42, coffee_id: 7, batch_name: 'Batch A' },
          { roast_id: 43, coffee_id: 7, batch_name: 'Batch A' },
        ],
      })
    );
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { get, list } } as never);

    await expect(resolveSaleRoast({ roastId: 42 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('cannot retain a roast ID'),
    });
  });

  it('rejects an exact roast with no inventory link', async () => {
    const get = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast_id: 42, coffee_id: null, batch_name: null } }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { get } } as never);
    await expect(resolveSaleRoast({ roastId: 42 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('post-filters partial batch matches and resolves one exact match', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          data: [
            { roast_id: 1, coffee_id: 7, batch_name: 'Batch A extra' },
            { roast_id: 2, coffee_id: 7, batch_name: 'Batch A' },
            { roast_id: 3, coffee_id: 8, batch_name: 'Batch A' },
          ],
        })
      )
      .mockResolvedValueOnce(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).resolves.toMatchObject({
      roastId: 2,
      mode: 'resolved',
    });
    expect(list).toHaveBeenCalledWith({
      coffee_id: 7,
      batch_name: 'Batch A',
      limit: 100,
      offset: 0,
    });
  });

  it('preserves zero-match and ambiguity errors after exact post-filtering', async () => {
    const list = vi.fn();
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);
    list.mockResolvedValueOnce(
      ok({ data: [{ roast_id: 1, coffee_id: 7, batch_name: 'Batch A extra' }] })
    );
    list.mockResolvedValueOnce(ok({ data: [] }));
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    list.mockResolvedValueOnce(
      ok({
        data: [
          { roast_id: 2, coffee_id: 7, batch_name: 'Batch A' },
          { roast_id: 3, coffee_id: 7, batch_name: 'Batch A' },
        ],
      })
    );
    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('advances by capped page length and finds an exact match after a 25-row page', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      roast_id: index + 1,
      coffee_id: 7,
      batch_name: `Batch A partial ${index}`,
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: firstPage }))
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 26, coffee_id: 7, batch_name: 'Batch A' }] }))
      .mockResolvedValueOnce(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

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

  it('detects ambiguity when a second exact match is on a later capped page', async () => {
    const firstPage = [
      { roast_id: 1, coffee_id: 7, batch_name: 'Batch A' },
      ...Array.from({ length: 24 }, (_, index) => ({
        roast_id: index + 2,
        coffee_id: 7,
        batch_name: `Batch A partial ${index}`,
      })),
    ];
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: firstPage }))
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 26, coffee_id: 7, batch_name: 'Batch A' }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 25 }));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not skip a later exact match after deduplicating overlapping pages', async () => {
    const exact = { roast_id: 1, coffee_id: 7, batch_name: 'Batch A' };
    const list = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          data: [exact, { roast_id: 2, coffee_id: 7, batch_name: 'Batch A partial' }],
        })
      )
      .mockResolvedValueOnce(
        ok({
          data: [exact, { roast_id: 3, coffee_id: 7, batch_name: 'Batch A other' }],
        })
      )
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 4, coffee_id: 7, batch_name: 'Batch A' }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

    await expect(resolveSaleRoast({ coffeeId: 7, batchName: 'Batch A' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 2 }));
    expect(list).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 3 }));
  });

  it('rejects a non-empty page containing no unseen roast IDs', async () => {
    const page = [{ roast_id: 1, coffee_id: 7, batch_name: 'Batch A partial' }];
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
    const get = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast_id: 42, coffee_id: 7, batch_name: 'Batch A' } }));
    const create = vi.fn().mockResolvedValue(ok({ data: { id: 55 } }, 201));
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 42, coffee_id: 7, batch_name: 'Batch A' }] }))
      .mockResolvedValueOnce(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { get, list },
      sales: { create },
    } as never);
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
        batchName: 'Batch A',
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
    const get = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast_id: 42, coffee_id: 7, batch_name: 'B' } }));
    const create = vi.fn().mockResolvedValue({
      error: { error: { message: 'writes disabled' } },
      response: new Response(null, { status: 503 }),
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [{ roast_id: 42, coffee_id: 7, batch_name: 'B' }] }))
      .mockResolvedValueOnce(ok({ data: [] }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { get, list },
      sales: { create },
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
