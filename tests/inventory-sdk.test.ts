import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});

import {
  addInventory,
  deleteInventory,
  getInventory,
  listInventory,
  updateInventory,
  type InventoryItem,
} from '../src/lib/inventory.js';
import { createParchmentClient } from '../src/lib/parchment.js';

const item = (id: number): InventoryItem => ({
  id,
  rank: null,
  notes: null,
  cupping_notes: null,
  purchase_date: '2026-07-01',
  purchased_qty_lbs: 5,
  bean_cost: 8,
  tax_ship_cost: 1,
  last_updated: '2026-07-01T00:00:00Z',
  user: 'user-1',
  catalog_id: 42,
  stocked: true,
  coffee_catalog: null,
});

const ok = <T>(data: T, status = 200) => ({
  data,
  response: new Response(null, { status }),
});

describe('inventory SDK data plane', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards list filters and unwraps owner-scoped inventory data', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [item(7)], meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { list } } as never);

    await expect(
      listInventory({
        stocked_only: true,
        catalogId: 42,
        origin: 'Ethiopia',
        limit: 10,
        offset: 20,
      })
    ).resolves.toEqual([item(7)]);
    expect(createParchmentClient).toHaveBeenCalledWith('member');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        stocked_only: true,
        catalogId: 42,
        origin: 'Ethiopia',
        limit: 10,
        offset: 20,
      })
    );
  });

  it('finds a single item through paginated owner inventory', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => item(index + 1));
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: firstPage, meta: {} }))
      .mockResolvedValueOnce(ok({ data: [item(101)], meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { list } } as never);

    await expect(getInventory(101)).resolves.toEqual(item(101));
    expect(list).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(list).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
  });

  it('returns NOT_FOUND when a single item is absent from owner inventory', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [], meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { list } } as never);

    await expect(getInventory(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creates with an idempotency key and canonical request fields', async () => {
    const create = vi.fn().mockResolvedValue(ok({ data: item(7), meta: {} }, 201));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { create } } as never);

    await expect(addInventory({ catalogId: 42, qty: 5, cost: 8 })).resolves.toEqual(item(7));
    expect(create).toHaveBeenCalledWith(
      { catalogId: 42, qty: 5, cost: 8 },
      { idempotencyKey: expect.any(String) }
    );
  });

  it('updates through the canonical owner-scoped endpoint', async () => {
    const update = vi.fn().mockResolvedValue(ok({ data: item(7), meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { update } } as never);

    await expect(updateInventory(7, { qty: 3, stocked: false })).resolves.toEqual(item(7));
    expect(update).toHaveBeenCalledWith(7, { qty: 3, stocked: false });
  });

  it('deletes without attempting a client-side cascade', async () => {
    const remove = vi.fn().mockResolvedValue(ok({ data: { id: 7, deleted: true }, meta: {} }));
    vi.mocked(createParchmentClient).mockResolvedValue({ inventory: { delete: remove } } as never);

    await expect(deleteInventory(7)).resolves.toEqual({
      deletedInventoryId: 7,
      deletedRoasts: 0,
      deletedSales: 0,
    });
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('rejects legacy force-cascade before making an API request', async () => {
    await expect(deleteInventory(7, { force: true })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--force is no longer supported'),
    });
    expect(createParchmentClient).not.toHaveBeenCalled();
  });
});
