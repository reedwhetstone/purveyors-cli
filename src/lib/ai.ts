/** AI roast classification through the canonical Parchment API. */

import type { CredentialContext } from './auth-client.js';
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

/** Published pre-0.32 structural input retained for downstream package consumers. */
export interface LegacyClassifyAuthFacade {
  auth: {
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
    }>;
  };
}

const CLASSIFICATION_STRING_LIMIT = 500;
const CLASSIFICATION_NOTES_LIMIT = 2_000;
const CLASSIFICATION_WEIGHT_UNIT_LIMIT = 16;
const CLASSIFICATION_INVENTORY_LIMIT = 100;

function normalizeOptionalString(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeWeight(value: unknown): [number, number, string] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [input, output, rawUnit] = value;
  const unit = normalizeOptionalString(
    typeof rawUnit === 'string' ? rawUnit : undefined,
    CLASSIFICATION_WEIGHT_UNIT_LIMIT
  );
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0 ||
    !unit
  ) {
    return undefined;
  }
  return [input, output, unit];
}

function normalizeClassificationInput(input: ClassifyRoastInput): ClassifyRoastInput {
  const filename = normalizeOptionalString(
    input.alogMetadata.filename,
    CLASSIFICATION_STRING_LIMIT
  );
  const title =
    normalizeOptionalString(input.alogMetadata.title, CLASSIFICATION_STRING_LIMIT) ?? filename;
  if (!title) {
    throw new Error(
      'Invalid roast classification input: alogMetadata.title and filename cannot both be blank.'
    );
  }

  const inventory = input.inventory.slice(0, CLASSIFICATION_INVENTORY_LIMIT).map((item, index) => {
    if (!Number.isInteger(item.id) || item.id <= 0) {
      throw new Error(
        `Invalid roast classification input: inventory[${index}].id must be a positive integer.`
      );
    }
    const coffeeName =
      normalizeOptionalString(item.coffee_name, CLASSIFICATION_STRING_LIMIT) ?? `Bean #${item.id}`;
    return {
      id: item.id,
      coffee_name: coffeeName,
      origin: normalizeOptionalString(item.origin, CLASSIFICATION_STRING_LIMIT),
      processing: normalizeOptionalString(item.processing, CLASSIFICATION_STRING_LIMIT),
    };
  });

  return {
    alogMetadata: {
      title,
      filename,
      roastertype: normalizeOptionalString(
        input.alogMetadata.roastertype,
        CLASSIFICATION_STRING_LIMIT
      ),
      beans: normalizeOptionalString(input.alogMetadata.beans, CLASSIFICATION_STRING_LIMIT),
      roastingnotes: normalizeOptionalString(
        input.alogMetadata.roastingnotes,
        CLASSIFICATION_NOTES_LIMIT
      ),
      weight: normalizeWeight(input.alogMetadata.weight),
    },
    inventory,
  };
}

async function resolveClassificationApiKey(
  source: CredentialContext | LegacyClassifyAuthFacade
): Promise<string | undefined> {
  if ('getSession' in source) {
    const {
      data: { session },
    } = await source.getSession();
    return session?.apiKey;
  }

  const {
    data: { session },
  } = await source.auth.getSession();
  return session?.access_token;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Classify which inventory bean an .alog roast file corresponds to.
 *
 * Requires an authenticated session. The canonical API validates the member
 * entitlement and the token's owner-bound roast scope server-side.
 */
export async function classifyRoast(
  credentialContext: CredentialContext | LegacyClassifyAuthFacade,
  input: ClassifyRoastInput
): Promise<ClassifyRoastResult> {
  // Resolve the current stored API key at the request boundary.
  const apiKey = await resolveClassificationApiKey(credentialContext);
  if (!apiKey) {
    throw new Error('Not authenticated. Run `purvey auth login` first.');
  }

  const client = await createParchmentClient('member', apiKey);
  const data = unwrapParchment(
    await client.roasts.classify(normalizeClassificationInput(input)),
    'AI roast classification'
  );

  // Keep the historical library contract tolerant of an omitted match.
  return {
    match: data.match ?? null,
  };
}
