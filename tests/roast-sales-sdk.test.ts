import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/parchment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/parchment.js')>();
  return { ...actual, createParchmentClient: vi.fn() };
});

import { createParchmentClient } from '../src/lib/parchment.js';
import {
  clearRoastArtisanImport,
  createRoast,
  deleteRoast,
  getRoast,
  listRoasts,
  replaceRoastArtisanImport,
  updateRoast,
} from '../src/lib/roast.js';
import { listSales } from '../src/lib/sales.js';
import { createInteractiveRoast, createWatchRoastImporter } from '../src/commands/roast.js';
import { recordInteractiveSale } from '../src/commands/sales.js';

const ok = <T>(data: T) => ({ data, response: new Response(null, { status: 200 }) });

describe('SDK-backed roast and sales data planes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps all roast list filters and forwards a token override', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [{ roast_id: 9 }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { list } } as never);

    await expect(
      listRoasts(
        {
          coffee_id: 7,
          roast_id: 9,
          batch_name: 'Guji',
          coffee_name: 'Ethiopia',
          date_start: '2026-01-01',
          date_end: '2026-02-01',
          stocked_only: true,
          catalog_id: 12,
          limit: 10,
          offset: 20,
        },
        'session-token'
      )
    ).resolves.toEqual([{ roast_id: 9 }]);
    expect(createParchmentClient).toHaveBeenCalledWith('member', 'session-token');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ catalog_id: 12, offset: 20 }));
  });

  it('requests temperatures and events through roast detail', async () => {
    const roast = { roast_id: 9, temperatures: [{ time_seconds: 0 }], events: [] };
    const get = vi.fn().mockResolvedValue(ok({ data: roast }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { get } } as never);
    await expect(getRoast(9, { includeTemps: true, includeEvents: true })).resolves.toBe(roast);
    expect(get).toHaveBeenCalledWith('9', { includeTemps: true, includeEvents: true });
  });

  it('maps create, update, and delete operations', async () => {
    const create = vi.fn().mockResolvedValue(ok({ data: { roast_id: 10 } }));
    const update = vi.fn().mockResolvedValue(ok({ data: { roast_id: 10, roast_notes: 'better' } }));
    const remove = vi.fn().mockResolvedValue(ok({ data: { id: 10, deleted: true } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { create, update, delete: remove },
    } as never);
    await createRoast({ coffeeId: 2, notes: 'first' });
    expect(create).toHaveBeenCalledWith(
      { coffeeId: 2, notes: 'first' },
      { idempotencyKey: expect.any(String) }
    );
    await updateRoast(10, { notes: 'better', ozOut: 12 });
    expect(update).toHaveBeenCalledWith(10, { notes: 'better', ozOut: 12 });
    await deleteRoast(10);
    expect(remove).toHaveBeenCalledWith(10);
  });

  it('maps Artisan replace and clear operations', async () => {
    const replaceArtisanImport = vi
      .fn()
      .mockResolvedValue(ok({ data: { roast: { roast_id: 10 } } }));
    const clearArtisanImport = vi
      .fn()
      .mockResolvedValue(ok({ data: { id: 10, deletedCounts: {}, batchName: 'B' } }));
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { replaceArtisanImport, clearArtisanImport },
    } as never);
    await replaceRoastArtisanImport(10, { fileName: 'r.alog', fileContent: '{}' });
    expect(replaceArtisanImport).toHaveBeenCalledWith(10, {
      fileName: 'r.alog',
      fileContent: '{}',
    });
    await clearRoastArtisanImport(10);
    expect(clearArtisanImport).toHaveBeenCalledWith(10);
  });

  it('refreshes and pins the session token for every watched import', async () => {
    const sdkImport = vi.fn().mockResolvedValue(
      ok({
        data: {
          roast: { roast_id: 10, coffee_id: 7, batch_name: 'B', events: [] },
          import: { temperaturePoints: 2, milestoneEvents: 0, controlEvents: 0 },
        },
      })
    );
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { import: sdkImport },
    } as never);
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: 'fresh-1' } } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'fresh-2' } } });
    const importer = createWatchRoastImporter({ auth: { getSession } } as never);
    const args = {
      fileContent: '{}',
      fileName: 'r.alog',
      coffeeId: 7,
      batchName: 'B',
    };
    await importer(args);
    await importer(args);
    expect(createParchmentClient).toHaveBeenNthCalledWith(1, 'member', 'fresh-1');
    expect(createParchmentClient).toHaveBeenNthCalledWith(2, 'member', 'fresh-2');
    expect(sdkImport).toHaveBeenCalledTimes(2);
  });

  it('resolves the freshest session token at each interactive create write', async () => {
    const create = vi.fn().mockResolvedValue(ok({ data: { roast_id: 11 } }));
    vi.mocked(createParchmentClient).mockResolvedValue({ roasts: { create } } as never);
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: 'form-token-before-rotation' } } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'form-token-after-rotation' } } });
    const supabase = { auth: { getSession } } as never;

    await createInteractiveRoast(supabase, { coffeeId: 7, batchName: 'First' });
    await createInteractiveRoast(supabase, { coffeeId: 7, batchName: 'Second' });

    expect(createParchmentClient).toHaveBeenNthCalledWith(
      1,
      'member',
      'form-token-before-rotation'
    );
    expect(createParchmentClient).toHaveBeenNthCalledWith(2, 'member', 'form-token-after-rotation');
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('maps only sales reads to the SDK sales list contract', async () => {
    const list = vi.fn().mockResolvedValue(ok({ data: [{ id: 3 }] }));
    vi.mocked(createParchmentClient).mockResolvedValue({ sales: { list } } as never);
    await expect(
      listSales({
        greenCoffeeInvId: 7,
        dateStart: '2026-01-01',
        dateEnd: '2026-01-31',
        buyer: 'Ada',
        limit: 5,
        offset: 10,
      })
    ).resolves.toEqual([{ id: 3 }]);
    expect(list).toHaveBeenCalledWith({
      green_coffee_inv_id: 7,
      date_start: '2026-01-01',
      date_end: '2026-01-31',
      buyer: 'Ada',
      limit: 5,
      offset: 10,
    });
  });

  it('refreshes after interactive selection and pins the rotated token through resolve and create', async () => {
    const order: string[] = [];
    const get = vi.fn().mockImplementation(() => {
      order.push('resolve');
      return Promise.resolve(ok({ data: { roast_id: 9, coffee_id: 7, batch_name: 'Batch A' } }));
    });
    const create = vi.fn().mockImplementation(() => {
      order.push('create');
      return Promise.resolve(ok({ data: { id: 3 } }));
    });
    vi.mocked(createParchmentClient).mockResolvedValue({
      roasts: { get },
      sales: { create },
    } as never);
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: 'selection-token' } } })
      .mockResolvedValueOnce({ data: { session: { access_token: 'fresh-write-token' } } });
    const selectRoast = vi.fn().mockImplementation(async () => {
      order.push('select');
      return { id: 9, batchName: 'Batch A' };
    });
    const onWriteStart = vi.fn(() => order.push('spinner'));

    await recordInteractiveSale(
      { auth: { getSession } },
      { oz: 12, price: 18, sellDate: '2026-07-12' },
      selectRoast,
      onWriteStart
    );

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(selectRoast).toHaveBeenCalledWith('selection-token');
    expect(createParchmentClient).toHaveBeenNthCalledWith(1, 'member', 'fresh-write-token');
    expect(createParchmentClient).toHaveBeenNthCalledWith(2, 'member', 'fresh-write-token');
    expect(order).toEqual(['select', 'spinner', 'resolve', 'create']);
  });

  it('does not write when the session expires during interactive sale selection', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: 'selection-token' } } })
      .mockResolvedValueOnce({ data: { session: null } });
    const selectRoast = vi.fn().mockResolvedValue({ id: 9, batchName: 'Batch A' });

    await expect(
      recordInteractiveSale({ auth: { getSession } }, { oz: 12, price: 18 }, selectRoast)
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });

    expect(selectRoast).toHaveBeenCalledWith('selection-token');
    expect(createParchmentClient).not.toHaveBeenCalled();
  });
});
