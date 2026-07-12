import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { PrvrsError } from './errors.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: number;
  rank: number | null;
  notes: string | null;
  cupping_notes: string | null;
  purchase_date: string | null;
  purchased_qty_lbs: number | null;
  bean_cost: number | null;
  tax_ship_cost: number | null;
  last_updated: string;
  user: string;
  catalog_id: number | null;
  stocked: boolean | null;
  coffee_catalog: {
    id: number;
    name: string | null;
    source: string | null;
    country: string | null;
    region: string | null;
    processing: string | null;
    cost_lb: number | null;
    price_per_lb: number | null;
    price_tiers: Array<{ min_lbs: number; price: number }> | null;
    description_short: string | null;
    stocked: boolean | null;
  } | null;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const listInventorySchema = z.object({
  stocked_only: z.boolean().optional().describe('Only show currently stocked beans'),
  limit: z.number().int().min(1).default(20).describe('Maximum results to return'),
  offset: z.number().int().min(0).optional().describe('Skip N results (for pagination)'),
  catalogId: z.number().int().positive().optional().describe('Filter by catalog ID'),
  purchaseDateStart: z.string().optional().describe('Only show purchases on or after this date'),
  purchaseDateEnd: z.string().optional().describe('Only show purchases on or before this date'),
  origin: z.string().optional().describe('Filter by country of origin (partial match)'),
});

export type ListInventoryInput = z.input<typeof listInventorySchema>;

export const getInventorySchema = z.object({
  id: z.number().int().positive(),
});

export type GetInventoryInput = z.input<typeof getInventorySchema>;

export const addInventorySchema = z.object({
  catalogId: z.number().int().positive(),
  qty: z.number().positive(),
  cost: z.number().optional(),
  taxShip: z.number().optional(),
  notes: z.string().optional(),
  purchaseDate: z.string().optional(),
});

export type AddInventoryInput = z.input<typeof addInventorySchema>;

export const updateInventorySchema = z
  .object({
    qty: z.number().positive().optional(),
    cost: z.number().optional(),
    taxShip: z.number().optional(),
    notes: z.string().optional(),
    stocked: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => v[k as keyof typeof v] !== undefined), {
    message: 'No update fields provided. Pass at least one of: qty, cost, taxShip, notes, stocked.',
  });

export type UpdateInventoryInput = z.input<typeof updateInventorySchema>;

export const deleteInventorySchema = z.object({
  id: z.number().int().positive(),
});

export type DeleteInventoryInput = z.input<typeof deleteInventorySchema>;

export interface DeleteInventoryResult {
  deletedInventoryId: number;
  deletedRoasts: number;
  deletedSales: number;
}

export interface DeleteInventoryOptions {
  force?: boolean;
}

// ─── Pure lib functions ───────────────────────────────────────────────────────

/**
 * List green coffee inventory for a user.
 */
export async function listInventory(
  opts: ListInventoryInput,
  tokenOverride?: string
): Promise<InventoryItem[]> {
  const parsed = listInventorySchema.parse(opts);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.inventory.list({
      stocked_only: parsed.stocked_only,
      catalogId: parsed.catalogId,
      purchaseDateStart: parsed.purchaseDateStart,
      purchaseDateEnd: parsed.purchaseDateEnd,
      origin: parsed.origin,
      limit: parsed.limit,
      offset: parsed.offset,
    }),
    'Inventory list'
  );
  return envelope.data as InventoryItem[];
}

/**
 * Fetch a single inventory item by ID (must belong to userId).
 */
export async function getInventory(id: number, tokenOverride?: string): Promise<InventoryItem> {
  getInventorySchema.parse({ id });
  const client = await createParchmentClient('member', tokenOverride);
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const envelope = unwrapParchment(
      await client.inventory.list({ limit: pageSize, offset }),
      'Inventory get'
    );
    const item = (envelope.data as InventoryItem[]).find((row) => row.id === id);
    if (item) return item;
    if (envelope.data.length < pageSize) break;
  }
  throw new PrvrsError('NOT_FOUND', `Inventory item ${id} not found or does not belong to you.`);
}

/**
 * Add a new inventory item for a user.
 */
export async function addInventory(
  input: AddInventoryInput,
  tokenOverride?: string
): Promise<InventoryItem> {
  const parsed = addInventorySchema.parse(input);
  const client = await createParchmentClient('member', tokenOverride);
  const envelope = unwrapParchment(
    await client.inventory.create(parsed, { idempotencyKey: randomUUID() }),
    'Inventory create'
  );
  return envelope.data as InventoryItem;
}

/**
 * Update an existing inventory item (must belong to userId).
 */
export async function updateInventory(
  id: number,
  input: UpdateInventoryInput
): Promise<InventoryItem> {
  getInventorySchema.parse({ id });
  const parsed = updateInventorySchema.parse(input);
  const client = await createParchmentClient('member');
  const envelope = unwrapParchment(await client.inventory.update(id, parsed), 'Inventory update');
  return envelope.data as InventoryItem;
}

/**
 * Delete an inventory item (must belong to userId).
 *
 * The canonical API refuses deletion when dependent roast or sales rows exist.
 * Client-side force cascading is intentionally unsupported because it would
 * bypass the API's per-resource authorization, idempotency, and audit controls.
 */
export async function deleteInventory(
  id: number,
  opts?: DeleteInventoryOptions
): Promise<DeleteInventoryResult> {
  deleteInventorySchema.parse({ id });
  if (opts?.force) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      '--force is no longer supported. Delete dependent roast profiles and sales explicitly before deleting the inventory item.'
    );
  }
  const client = await createParchmentClient('member');
  unwrapParchment(await client.inventory.delete(id), 'Inventory delete');
  return {
    deletedInventoryId: id,
    deletedRoasts: 0,
    deletedSales: 0,
  };
}
