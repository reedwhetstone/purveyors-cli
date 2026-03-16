/**
 * AI classification client for purveyors.io.
 * Proxies requests through the purveyors.io API — never calls AI providers directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassifyRoastInput {
  alogMetadata: {
    title: string;
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
 * Call the purveyors.io AI proxy to classify which inventory bean
 * an .alog roast file corresponds to.
 *
 * Requires authenticated session. The proxy validates member role server-side.
 */
export async function classifyRoast(
  supabase: SupabaseClient,
  input: ClassifyRoastInput
): Promise<ClassifyRoastResult> {
  // Get the current session token for auth
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated. Run `purvey auth login` first.');
  }

  const baseUrl = process.env.PURVEYORS_BASE_URL ?? 'https://purveyors.io';

  const response = await fetch(`${baseUrl}/api/ai/classify-roast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Member role required for AI features.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Try again later.');
    }
    throw new Error(`AI classification failed: ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Normalize: server may return { match: undefined } or omit match entirely
  return {
    match: data.match ?? null,
  } as ClassifyRoastResult;
}
