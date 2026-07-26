/**
 * Interactive form helpers for `purvey` write commands.
 * CLI-only — not exported via package.json subpaths.
 * All functions use @clack/prompts for step-by-step TUI wizards.
 */

import * as p from '@clack/prompts';
import { listRoasts } from '../roast.js';
import { listInventory } from '../inventory.js';
import { searchCatalog } from '../catalog.js';

// ─── Cancel guard ─────────────────────────────────────────────────────────────

/** Call after any clack result to abort cleanly on Ctrl+C / Escape. */
export function guardCancel(result: unknown): void {
  if (p.isCancel(result)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }
}

// ─── Pickers ──────────────────────────────────────────────────────────────────

/**
 * Interactive bean picker — shows user's inventory beans and lets them select one.
 * Returns the selected bean's ID and name.
 *
 * By default a cancelled prompt (Ctrl+C / Escape) exits the process. Pass
 * `{ allowCancel: true }` to get `null` back instead, for callers that must
 * keep running after a cancelled selection (e.g. `roast watch --prompt-each`).
 */
export async function pickBean(tokenOverride?: string): Promise<{ id: number; name: string }>;
export async function pickBean(
  tokenOverride: string | undefined,
  options: { allowCancel: boolean }
): Promise<{ id: number; name: string } | null>;
export async function pickBean(
  tokenOverride?: string,
  options: { allowCancel?: boolean } = {}
): Promise<{ id: number; name: string } | null> {
  const rows = await listInventory({ stocked_only: true, limit: 50 }, tokenOverride);

  if (rows.length === 0) {
    if (options.allowCancel) {
      p.log.warn('No stocked beans found in your inventory. Add some first.');
      return null;
    }
    p.cancel('No stocked beans found in your inventory. Add some first.');
    process.exit(0);
  }

  const selectOptions = rows.map((row) => {
    const name = row.coffee_catalog?.name ?? `Bean #${row.id}`;
    return { value: String(row.id), label: `${name} (#${row.id})`, hint: name };
  });

  const selected = await p.select({
    message: 'Select a bean from your inventory',
    options: selectOptions,
  });

  if (options.allowCancel && p.isCancel(selected)) {
    return null;
  }
  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.id === selectedId);
  const name = matchedRow?.coffee_catalog?.name ?? `Bean #${selectedId}`;

  return { id: selectedId, name };
}

/**
 * Interactive roast picker — shows user's roast profiles, lets them select one.
 * Returns the selected roast's ID and batch name.
 */
export async function pickRoast(
  tokenOverride?: string
): Promise<{ id: number; batchName: string }> {
  const rows = await listRoasts({ limit: 50 }, tokenOverride);

  if (rows.length === 0) {
    p.cancel('No roast profiles found. Create one first.');
    process.exit(0);
  }

  const options = rows.map((row) => {
    const label = row.batch_name ?? `Roast #${row.roast_id}`;
    const hint = row.roast_date ?? undefined;
    return { value: String(row.roast_id), label, hint };
  });

  const selected = await p.select({
    message: 'Select a roast profile',
    options,
  });

  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.roast_id === selectedId);
  const batchName = matchedRow?.batch_name ?? `Roast #${selectedId}`;

  return { id: selectedId, batchName };
}

/**
 * Interactive catalog search — user types search term, sees matching coffees.
 * Returns selected catalog item ID and name.
 */
export async function pickCatalogItem(): Promise<{ id: number; name: string }> {
  const searchTerm = await p.text({
    message: 'Search coffee catalog (origin or name)',
    placeholder: 'e.g. Ethiopia or Guji',
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'Please enter a search term.';
    },
  });

  guardCancel(searchTerm);

  const term = (searchTerm as string).trim();
  const [byName, byOrigin] = await Promise.all([
    searchCatalog({ name: term, limit: 20 }),
    searchCatalog({ origin: term, limit: 20 }),
  ]);
  const rows = [...new Map([...byName, ...byOrigin].map((row) => [row.id, row])).values()].slice(
    0,
    20
  );

  if (rows.length === 0) {
    p.cancel(`No coffees found matching "${term}". Try a different search.`);
    process.exit(0);
  }

  const options = rows.map((row) => {
    const label = row.name ?? `Catalog #${row.id}`;
    const parts = [
      row.country,
      row.processing,
      (row.price_per_lb ?? row.cost_lb) ? `$${row.price_per_lb ?? row.cost_lb}/lb` : null,
    ].filter(Boolean);
    const hint = parts.join(' · ') || undefined;
    return { value: String(row.id), label, hint };
  });

  const selected = await p.select({
    message: 'Select a coffee',
    options,
  });

  guardCancel(selected);

  const selectedId = parseInt(selected as string, 10);
  const matchedRow = rows.find((r) => r.id === selectedId);
  const name = matchedRow?.name ?? `Catalog #${selectedId}`;

  return { id: selectedId, name };
}
