import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError, PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';

export interface Sale {
  id: number;
  roast_id?: number | null;
  green_coffee_inv_id?: number;
  batch_name?: string | null;
  coffee_name?: string | null;
  oz_sold: number | null;
  sale_price?: number | null;
  price?: number | null;
  purchase_date?: string | null;
  buyer: string | null;
  sell_date: string | null;
  user: string | null;
  wholesale?: boolean;
}

export interface ResolvedSaleTarget {
  greenCoffeeInvId: number;
  batchName?: string;
  roastId: number;
  mode: 'exact' | 'resolved';
}

export const listSalesSchema = z.object({
  limit: z.number().int().min(1).default(20),
  offset: z.number().int().min(0).optional(),
  greenCoffeeInvId: z.number().int().positive().optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  buyer: z.string().optional(),
});
export type ListSalesInput = z.input<typeof listSalesSchema>;

const saleTargetFields = {
  roastId: z.number().int().positive().optional(),
  coffeeId: z.number().int().positive().optional(),
  batchName: z.string().trim().min(1).optional(),
};

function validateSaleTargetSelector(
  value: { roastId?: number; coffeeId?: number; batchName?: string },
  ctx: z.RefinementCtx
) {
  const hasRoastId = value.roastId !== undefined;
  const hasCoffeeId = value.coffeeId !== undefined;
  const hasBatchName = value.batchName !== undefined;
  if (hasRoastId && (hasCoffeeId || hasBatchName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Use either roastId or coffeeId + batchName, not both.',
    });
    return;
  }
  if (!hasRoastId && !hasCoffeeId && !hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastId'],
      message: 'Provide roastId or coffeeId + batchName.',
    });
    return;
  }
  if (!hasRoastId && hasCoffeeId !== hasBatchName) {
    ctx.addIssue({
      code: 'custom',
      path: hasCoffeeId ? ['batchName'] : ['coffeeId'],
      message: 'coffeeId and batchName must be provided together when roastId is absent.',
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

export const deleteSaleSchema = z.object({ id: z.number().int().positive() });
export type DeleteSaleInput = z.input<typeof deleteSaleSchema>;

type SalesParchmentClient = Awaited<ReturnType<typeof createParchmentClient>>;

async function legacySessionToken(supabase: SupabaseClient): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new AuthError('Sales operations require an authenticated Purveyors session.');
  }
  return session.access_token;
}

async function listExactSaleRoastMatches(
  client: SalesParchmentClient,
  coffeeId: number,
  batchName: string | undefined
) {
  const exactMatches: Array<{
    roast_id: number;
    coffee_id: number | null;
    batch_name: string | null;
  }> = [];
  const pageSize = 100;
  let offset = 0;
  const seenRoastIds = new Set<number>();
  do {
    const envelope = unwrapParchment(
      await client.roasts.list({
        coffee_id: coffeeId,
        batch_name: batchName,
        limit: pageSize,
        offset,
      }),
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
    exactMatches.push(
      ...unseenRows.filter(
        (row) => row.coffee_id === coffeeId && (row.batch_name ?? undefined) === batchName
      )
    );
    if (exactMatches.length > 1) break;
    offset += rows.length;
  } while (true);
  return exactMatches;
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
      limit: parsed.limit,
      offset: parsed.offset,
    }),
    'Sales list'
  );
  return envelope.data as Sale[];
}

export function resolveSaleRoast(
  input: SaleTargetSelectorInput,
  tokenOverride?: string
): Promise<ResolvedSaleTarget>;
export function resolveSaleRoast(
  supabase: SupabaseClient,
  userId: string,
  input: SaleTargetSelectorInput
): Promise<ResolvedSaleTarget>;
export async function resolveSaleRoast(
  inputOrSupabase: SaleTargetSelectorInput | SupabaseClient,
  tokenOverrideOrUserId?: string,
  legacyInput?: SaleTargetSelectorInput
): Promise<ResolvedSaleTarget> {
  const input = legacyInput ?? (inputOrSupabase as SaleTargetSelectorInput);
  const tokenOverride = legacyInput
    ? await legacySessionToken(inputOrSupabase as SupabaseClient)
    : tokenOverrideOrUserId;
  const parsed = saleTargetSelectorSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);

  if (parsed.roastId !== undefined) {
    const envelope = unwrapParchment(
      await client.roasts.get(String(parsed.roastId)),
      'Sale roast selector'
    );
    const roast = envelope.data;
    if (roast.coffee_id == null) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `Roast profile ${parsed.roastId} is not linked to a green coffee inventory item.`
      );
    }
    const batchName = roast.batch_name ?? undefined;
    const exactMatches = await listExactSaleRoastMatches(client, roast.coffee_id, batchName);
    if (exactMatches.length > 1) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        `Roast profile ${parsed.roastId} shares inventory item ${roast.coffee_id} and batch name "${batchName ?? ''}" with roast IDs ${exactMatches.map((row) => row.roast_id).join(', ')}. The canonical sales record cannot retain a roast ID; give each roast a unique batch name before recording this sale.`
      );
    }
    return {
      greenCoffeeInvId: roast.coffee_id,
      batchName,
      roastId: roast.roast_id,
      mode: 'exact',
    };
  }

  const exactMatches = await listExactSaleRoastMatches(client, parsed.coffeeId!, parsed.batchName);

  if (exactMatches.length === 0) {
    throw new PrvrsError(
      'NOT_FOUND',
      `No roast profile found for --coffee-id ${parsed.coffeeId} with batch name "${parsed.batchName}". Use 'purvey roast list --coffee-id ${parsed.coffeeId}' to inspect candidates, or pass --roast-id directly.`
    );
  }
  if (exactMatches.length > 1) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Multiple roast profiles match --coffee-id ${parsed.coffeeId} and batch name "${parsed.batchName}". Matching roast IDs: ${exactMatches.map((row) => row.roast_id).join(', ')}. The canonical sales record cannot retain a roast ID; give each roast a unique batch name before recording this sale.`
    );
  }
  return {
    greenCoffeeInvId: parsed.coffeeId!,
    batchName: parsed.batchName,
    roastId: exactMatches[0].roast_id,
    mode: 'resolved',
  };
}

export function recordSale(input: RecordSaleInput, tokenOverride?: string): Promise<Sale>;
export function recordSale(
  supabase: SupabaseClient,
  userId: string,
  input: RecordSaleInput
): Promise<Sale>;
export async function recordSale(
  inputOrSupabase: RecordSaleInput | SupabaseClient,
  tokenOverrideOrUserId?: string,
  legacyInput?: RecordSaleInput
): Promise<Sale> {
  const input = legacyInput ?? (inputOrSupabase as RecordSaleInput);
  const tokenOverride = legacyInput
    ? await legacySessionToken(inputOrSupabase as SupabaseClient)
    : tokenOverrideOrUserId;
  const parsed = recordSaleSchema.parse(input);
  const target = await resolveSaleRoast(parsed, tokenOverride);
  const client = await createParchmentClient('member', tokenOverride);
  const body = {
    greenCoffeeInvId: target.greenCoffeeInvId,
    ozSold: parsed.oz,
    price: parsed.price,
    ...(parsed.buyer !== undefined ? { buyer: parsed.buyer } : {}),
    ...(target.batchName !== undefined ? { batchName: target.batchName } : {}),
    ...(parsed.sellDate !== undefined ? { sellDate: parsed.sellDate } : {}),
  };
  const envelope = unwrapParchment(
    await client.sales.create(body, { idempotencyKey: randomUUID() }),
    'Sale create'
  );
  return envelope.data as Sale;
}

export function updateSale(
  id: number,
  input: UpdateSaleInput,
  tokenOverride?: string
): Promise<Sale>;
export function updateSale(
  supabase: SupabaseClient,
  userId: string,
  id: number,
  input: UpdateSaleInput
): Promise<Sale>;
export async function updateSale(
  idOrSupabase: number | SupabaseClient,
  inputOrUserId: UpdateSaleInput | string,
  tokenOverrideOrId?: string | number,
  legacyInput?: UpdateSaleInput
): Promise<Sale> {
  const legacyCall = typeof idOrSupabase !== 'number';
  const id = legacyCall ? (tokenOverrideOrId as number) : idOrSupabase;
  const input = legacyCall ? legacyInput! : (inputOrUserId as UpdateSaleInput);
  const tokenOverride = legacyCall
    ? await legacySessionToken(idOrSupabase)
    : (tokenOverrideOrId as string | undefined);
  deleteSaleSchema.parse({ id });
  const parsed = updateSaleSchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const body = {
    ...(parsed.oz !== undefined ? { ozSold: parsed.oz } : {}),
    ...(parsed.price !== undefined ? { price: parsed.price } : {}),
    ...(parsed.buyer !== undefined ? { buyer: parsed.buyer } : {}),
    ...(parsed.sellDate !== undefined ? { sellDate: parsed.sellDate } : {}),
  };
  const envelope = unwrapParchment(await client.sales.update(id, body), 'Sale update');
  return envelope.data as Sale;
}

export function deleteSale(id: number, tokenOverride?: string): Promise<void>;
export function deleteSale(supabase: SupabaseClient, userId: string, id: number): Promise<void>;
export async function deleteSale(
  idOrSupabase: number | SupabaseClient,
  tokenOverrideOrUserId?: string,
  legacyId?: number
): Promise<void> {
  const legacyCall = typeof idOrSupabase !== 'number';
  const id = legacyCall ? legacyId! : idOrSupabase;
  const tokenOverride = legacyCall ? await legacySessionToken(idOrSupabase) : tokenOverrideOrUserId;
  deleteSaleSchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  unwrapParchment(await client.sales.delete(id), 'Sale delete');
}
