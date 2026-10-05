import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';
import { POSTGRES_INT4_MAX } from './strict-number.js';

export interface Sale {
  id: number;
  /** The roast the sale drew from, when the seller named one. */
  roast_id?: number | null;
  green_coffee_inv_id?: number;
  /** The roast batch the sale drew from. Null when the sale names no single batch. */
  batch_id?: string | null;
  batch_name?: string | null;
  coffee_name?: string | null;
  oz_sold: number | null;
  sale_price?: number | null;
  price?: number | null;
  purchase_date?: string | null;
  buyer: string | null;
  sell_date: string | null;
  user: string | null;
  last_updated?: string;
  wholesale?: boolean;
}

export interface ResolvedSaleTarget {
  greenCoffeeInvId?: number;
  /** The one batch the sale is recorded against. Batch names may repeat; this id does not. */
  batchId?: string;
  batchName?: string;
  /** The selected roast in exact mode; the first roast of the item in the batch otherwise. */
  roastId: number;
  /**
   * Every roast of this inventory item in the batch, in ascending order, read
   * from the batch by id. Only exact mode records one of them on the sale; the
   * other modes record the sale against the batch as a whole.
   */
  batchRoastIds?: number[];
  /**
   * How the batch was chosen: `exact` from a roast id, `batch` from a batch id,
   * `resolved` from an inventory item and a batch name that matched one batch.
   */
  mode: 'exact' | 'batch' | 'resolved';
}

export const SALE_SELECT =
  'id, roast_id, oz_sold, sale_price, buyer, sell_date, user, last_updated';

export const listSalesSchema = z.object({
  limit: z.number().int().min(1).default(20),
  offset: z.number().int().min(0).optional(),
  greenCoffeeInvId: z.number().int().min(1).max(POSTGRES_INT4_MAX).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  buyer: z.string().optional(),
  batchId: z.string().uuid().optional(),
  roastId: z.number().int().min(1).max(POSTGRES_INT4_MAX).optional(),
});
export type ListSalesInput = z.input<typeof listSalesSchema>;

const saleTargetFields = {
  roastId: z.number().int().min(1).max(POSTGRES_INT4_MAX).optional(),
  coffeeId: z.number().int().min(1).max(POSTGRES_INT4_MAX).optional(),
  batchId: z.string().uuid().optional(),
  batchName: z.string().trim().min(1).optional(),
};

function validateSaleTargetSelector(
  value: { roastId?: number; coffeeId?: number; batchId?: string; batchName?: string },
  ctx: z.RefinementCtx
) {
  const hasRoastId = value.roastId !== undefined;
  const hasCoffeeId = value.coffeeId !== undefined;
  const hasBatchId = value.batchId !== undefined;
  const hasBatchName = value.batchName !== undefined;
  if (hasBatchId && hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: ['batchName'],
      message: 'Use either batchId or batchName, not both.',
    });
    return;
  }
  if (hasRoastId && (hasCoffeeId || hasBatchName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Use either roastId or coffeeId + batchName, not both.',
    });
    return;
  }
  if (hasRoastId || hasBatchId) return;
  if (!hasCoffeeId && !hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Provide roastId, batchId, or coffeeId + batchName.',
    });
    return;
  }
  if (hasCoffeeId !== hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: hasCoffeeId ? ['batchName'] : ['coffeeId'],
      message:
        'coffeeId and batchName must be provided together when roastId and batchId are absent.',
    });
  }
}

export const saleTargetSelectorSchema = z
  .object(saleTargetFields)
  .superRefine(validateSaleTargetSelector);
export type SaleTargetSelectorInput = z.input<typeof saleTargetSelectorSchema>;

export const recordSaleSchema = z
  .object({
    ...saleTargetFields,
    oz: z.number().positive(),
    price: z.number().min(0),
    buyer: z.string().optional(),
    sellDate: z.string().optional(),
  })
  .superRefine(validateSaleTargetSelector);
export type RecordSaleInput = z.input<typeof recordSaleSchema>;

export const updateSaleSchema = z
  .object({
    oz: z.number().positive().optional(),
    price: z.number().min(0).optional(),
    buyer: z.string().optional(),
    sellDate: z.string().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'No update fields provided. Pass at least one of: oz, price, buyer, sellDate.',
  });
export type UpdateSaleInput = z.input<typeof updateSaleSchema>;

export const deleteSaleSchema = z.object({
  id: z.number().int().min(1).max(POSTGRES_INT4_MAX),
});
export type DeleteSaleInput = z.input<typeof deleteSaleSchema>;

type SalesParchmentClient = Awaited<ReturnType<typeof createParchmentClient>>;

interface SaleRoastRow {
  roast_id: number;
  coffee_id: number | null;
  batch_id: string;
  batch_name: string | null;
}

/** Read every roast matching a selector query, following pagination to the end. */
async function listSaleRoastRows(
  client: SalesParchmentClient,
  query: { coffee_id: number; batch_id?: string; batch_name?: string }
): Promise<SaleRoastRow[]> {
  const collected: SaleRoastRow[] = [];
  const pageSize = 100;
  let offset = 0;
  const seenRoastIds = new Set<number>();
  do {
    const envelope = unwrapParchment(
      await client.roasts.list({ ...query, limit: pageSize, offset }),
      'Sale roast selector'
    );
    const rows = envelope.data;
    if (rows.length === 0) break;
    const unseenRows = rows.filter((row) => !seenRoastIds.has(row.roast_id));
    if (unseenRows.length === 0) {
      throw new PrvrsError(
        'GENERAL_ERROR',
        'Sale roast selector pagination did not advance. Retry the request.'
      );
    }
    for (const row of unseenRows) seenRoastIds.add(row.roast_id);
    collected.push(...unseenRows);
    offset += unseenRows.length;
  } while (true);
  return collected;
}

/** The roasts of one inventory item in one batch, selected by batch id rather than by name. */
async function listBatchRoastIds(
  client: SalesParchmentClient,
  batchId: string,
  coffeeId: number
): Promise<number[]> {
  const rows = await listSaleRoastRows(client, { coffee_id: coffeeId, batch_id: batchId });
  return sortedRoastIds(
    rows
      .filter((row) => row.coffee_id === coffeeId && row.batch_id === batchId)
      .map((row) => row.roast_id)
  );
}

function sortedRoastIds(roastIds: number[]): number[] {
  return [...new Set(roastIds)].sort((a, b) => a - b);
}

/** A batch a name-based selector could mean, with what tells the candidates apart. */
export interface SaleBatchCandidate {
  batchId: string;
  batchDate: string;
  roastIds: number[];
}

/**
 * Batch names repeat, so a name with an inventory item can match several
 * batches. Refuse with every candidate's id and date instead of picking one.
 */
async function ambiguousBatchNameError(
  client: SalesParchmentClient,
  coffeeId: number,
  batchName: string,
  roastIdsByBatch: Map<string, number[]>
): Promise<PrvrsError> {
  const candidates: SaleBatchCandidate[] = await Promise.all(
    [...roastIdsByBatch].map(async ([batchId, roastIds]) => {
      const envelope = unwrapParchment(
        await client.roastBatches.get(batchId),
        'Sale batch selector'
      );
      return { batchId, batchDate: envelope.data.batch_date, roastIds: sortedRoastIds(roastIds) };
    })
  );
  candidates.sort(
    (a, b) => b.batchDate.localeCompare(a.batchDate) || a.batchId.localeCompare(b.batchId)
  );

  const lines = candidates.map(
    (candidate) =>
      `  --batch-id ${candidate.batchId}   ${candidate.batchDate}, roast${candidate.roastIds.length !== 1 ? 's' : ''} ${candidate.roastIds.join(', ')}`
  );
  return new PrvrsError(
    'INVALID_ARGUMENT',
    `Batch name "${batchName}" matches ${candidates.length} batches with roasts of --coffee-id ${coffeeId}. Choose one by batch ID and run the command again with --batch-id in place of --batch-name:\n${lines.join('\n')}`,
    { code: 'batch_name_ambiguous', candidates }
  );
}

export async function listSales(
  opts: ListSalesInput = {},
  tokenOverride?: string
): Promise<Sale[]> {
  const parsed = listSalesSchema.parse(opts);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.sales.list({
      green_coffee_inv_id: parsed.greenCoffeeInvId,
      date_start: parsed.dateStart,
      date_end: parsed.dateEnd,
      buyer: parsed.buyer,
      batch_id: parsed.batchId,
      roast_id: parsed.roastId,
      limit: parsed.limit,
      offset: parsed.offset,
    }),
    'Sales list'
  );
  return envelope.data as Sale[];
}

export async function resolveSaleRoast(
  input: SaleTargetSelectorInput,
  tokenOverride?: string
): Promise<ResolvedSaleTarget & { batchId: string }> {
  const parsed = saleTargetSelectorSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);

  if (parsed.roastId !== undefined) {
    const getRoast = Promise.resolve(client.roasts.get(String(parsed.roastId))).then((result) =>
      unwrapParchment(result, 'Sale roast selector')
    );
    const envelope = await getRoast;
    const roast = envelope.data;
    if (roast.coffee_id == null) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `Roast profile ${parsed.roastId} is not linked to a green coffee inventory item.`
      );
    }
    if (parsed.batchId !== undefined && parsed.batchId !== roast.batch_id) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `Roast profile ${parsed.roastId} is in batch ${roast.batch_id}, not ${parsed.batchId}. A roast decides its own batch: drop --batch-id, or pass a roast from that batch.`
      );
    }
    // The sale names this roast. Its siblings in the batch are reported, not rejected.
    const siblings = await listBatchRoastIds(client, roast.batch_id, roast.coffee_id);
    return {
      greenCoffeeInvId: roast.coffee_id,
      batchId: roast.batch_id,
      batchName: roast.batch_name ?? undefined,
      roastId: roast.roast_id,
      batchRoastIds: sortedRoastIds([roast.roast_id, ...siblings]),
      mode: 'exact',
    };
  }

  if (parsed.batchId !== undefined) {
    const batch = unwrapParchment(
      await client.roastBatches.get(parsed.batchId),
      'Sale batch selector'
    ).data;
    const label = `Batch ${batch.id} (${batch.batch_date})`;
    if (batch.coffee_ids.length === 0) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `${label} holds no roasts, so there is nothing to sell from it.`
      );
    }
    if (parsed.coffeeId === undefined && batch.coffee_ids.length > 1) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `${label} holds roasts of more than one inventory item: ${batch.coffee_ids.join(', ')}. Pass --coffee-id to say which one was sold.`
      );
    }
    const coffeeId = parsed.coffeeId ?? batch.coffee_ids[0];
    const batchRoastIds = batch.coffee_ids.includes(coffeeId)
      ? await listBatchRoastIds(client, batch.id, coffeeId)
      : [];
    if (batchRoastIds.length === 0) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `${label} holds no roast of --coffee-id ${coffeeId}. It holds roasts of: ${batch.coffee_ids.join(', ')}.`
      );
    }
    return {
      greenCoffeeInvId: coffeeId,
      batchId: batch.id,
      batchName: batch.name,
      roastId: batchRoastIds[0],
      batchRoastIds,
      mode: 'batch',
    };
  }

  const coffeeId = parsed.coffeeId!;
  const batchName = parsed.batchName!;
  const nameMatches = (
    await listSaleRoastRows(client, { coffee_id: coffeeId, batch_name: batchName })
  )
    // The name filter is a partial, case-insensitive match; a batch name is matched exactly.
    .filter((row) => row.coffee_id === coffeeId && row.batch_name === batchName);

  if (nameMatches.length === 0) {
    throw new PrvrsError(
      'NOT_FOUND',
      `No roast profile found for --coffee-id ${coffeeId} with batch name "${batchName}". Use 'purvey roast list --coffee-id ${coffeeId}' to inspect candidates, or pass --batch-id or --roast-id directly.`
    );
  }

  const roastIdsByBatch = new Map<string, number[]>();
  for (const row of nameMatches) {
    roastIdsByBatch.set(row.batch_id, [...(roastIdsByBatch.get(row.batch_id) ?? []), row.roast_id]);
  }
  if (roastIdsByBatch.size > 1) {
    throw await ambiguousBatchNameError(client, coffeeId, batchName, roastIdsByBatch);
  }

  const [[batchId, namedRoastIds]] = [...roastIdsByBatch];
  // The name only chose the batch. The reported roasts come from the batch itself.
  const batchRoastIds = sortedRoastIds([
    ...namedRoastIds,
    ...(await listBatchRoastIds(client, batchId, coffeeId)),
  ]);
  return {
    greenCoffeeInvId: coffeeId,
    batchId,
    batchName,
    roastId: batchRoastIds[0],
    batchRoastIds,
    mode: 'resolved',
  };
}

export async function recordSale(input: RecordSaleInput, tokenOverride?: string): Promise<Sale> {
  const parsed = recordSaleSchema.parse(input);
  const target = await resolveSaleRoast(parsed, tokenOverride);
  const client = await createParchmentClient('member', tokenOverride);
  const body = {
    greenCoffeeInvId: target.greenCoffeeInvId!,
    ozSold: parsed.oz,
    price: parsed.price,
    ...(parsed.buyer !== undefined ? { buyer: parsed.buyer } : {}),
    // The sale takes the batch's name from the batch, so no name is sent beside the id.
    batchId: target.batchId,
    // A roast is recorded only when the seller named one. It is never inferred from the batch.
    ...(parsed.roastId !== undefined ? { roastId: target.roastId } : {}),
    ...(parsed.sellDate !== undefined ? { sellDate: parsed.sellDate } : {}),
  };
  const envelope = unwrapParchment(
    await client.sales.create(body, { idempotencyKey: randomUUID() }),
    'Sale create'
  );
  return envelope.data as Sale;
}

export async function updateSale(
  id: number,
  input: UpdateSaleInput,
  tokenOverride?: string
): Promise<Sale> {
  deleteSaleSchema.parse({ id });
  const parsed = updateSaleSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const body = {
    ...(parsed.oz !== undefined ? { ozSold: parsed.oz } : {}),
    ...(parsed.price !== undefined ? { price: parsed.price } : {}),
    ...(parsed.buyer !== undefined ? { buyer: parsed.buyer } : {}),
    ...(parsed.sellDate !== undefined ? { sellDate: parsed.sellDate } : {}),
  };
  const update = Promise.resolve(client.sales.update(id, body)).then((result) =>
    unwrapParchment(result, 'Sale update')
  );
  const envelope = await update;
  return envelope.data as Sale;
}

export async function deleteSale(id: number, tokenOverride?: string): Promise<void> {
  deleteSaleSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  const remove = Promise.resolve(client.sales.delete(id)).then((result) =>
    unwrapParchment(result, 'Sale delete')
  );
  await remove;
}
