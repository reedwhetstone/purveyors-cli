/** AI roast classification through the canonical Parchment API. */

import type { AuthClient } from './auth-client.js';
import { createParchmentClient, unwrapParchment } from './parchment.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassifyRoastInput {
  alogMetadata: {
    title: string;
    filename?: string;
    roastertype?: string;
    beans?: string;
    roastingnotes?: string;
    weight?: [number, number, string];
  };
  inventory: Array<{
    id: number;
    coffee_name: string;
    origin?: string;
    processing?: string;
  }>;
}

export interface ClassifyRoastResult {
  match: {
    inventoryId: number;
    coffeeName: string;
    confidence: number;
    reasoning: string;
  } | null;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Classify which inventory bean an .alog roast file corresponds to.
 *
 * Requires an authenticated session. The canonical API validates the member
 * entitlement and the token's owner-bound roast scope server-side.
 */
export async function classifyRoast(
  supabase: AuthClient,
  input: ClassifyRoastInput
): Promise<ClassifyRoastResult> {
  // Get the current session token for auth
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated. Run `purvey auth login` first.');
  }

  const client = await createParchmentClient('member', session.access_token);
  const data = unwrapParchment(await client.roasts.classify(input), 'AI roast classification');

  // Keep the historical library contract tolerant of an omitted match.
  return {
    match: data.match ?? null,
  };
}
