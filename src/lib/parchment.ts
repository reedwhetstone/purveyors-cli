import { createParchmentClient as createSdkClient, type ParchmentClient } from '@purveyors/sdk';
import { requireAuth, type RequiredRole } from './auth-guard.js';
import { AuthError, PrvrsError } from './errors.js';
import { getParchmentBaseUrl } from './parchment-base.js';
export { getParchmentBaseUrl } from './parchment-base.js';

/**
 * Resolve the canonical Parchment API base URL.
 *
 * Unlike the legacy hand-rolled catalog fetch paths (which default to the
 * coffee-app BFF at www.purveyors.io), SDK-backed commands talk to the
 * canonical API directly. `PARCHMENT_API_BASE_URL` takes precedence, then the
 * shared `PURVEYORS_BASE_URL` override, then the canonical default.
 */
/**
 * Resolve the bearer token for Parchment requests, mirroring the existing CLI
 * catalog auth pattern: an explicit API key wins, otherwise the stored Supabase
 * session JWT is used. Auth is resolved server-side against the token.
 */
export async function resolveParchmentToken(
  requiredRole: RequiredRole = 'viewer'
): Promise<string> {
  // Prefer the first non-empty key: an empty PARCHMENT_API_KEY (a common
  // optional-secret shape in CI) must not mask a real PURVEYORS_API_KEY.
  const apiKey = process.env.PARCHMENT_API_KEY || process.env.PURVEYORS_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  const { supabase } = await requireAuth(requiredRole);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new AuthError(
      'Parchment API reads require a Purveyors session or API key. Run `purvey auth login`, or set PARCHMENT_API_KEY/PURVEYORS_API_KEY.'
    );
  }

  return session.access_token;
}

/**
 * Return the stored session token when a valid local session satisfies the
 * requested role, without making that session mandatory. Commands that can be
 * API-key-only but should prefer the logged-in user's identity when one exists
 * use this to avoid mixing session-selected resource IDs with another account's
 * exported API key.
 */
export async function resolveParchmentSessionTokenIfAvailable(
  requiredRole: RequiredRole = 'viewer'
): Promise<string | undefined> {
  try {
    const { supabase } = await requireAuth(requiredRole);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token;
  } catch (error) {
    if (error instanceof AuthError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Build an authenticated Parchment SDK client for the canonical API.
 *
 * `tokenOverride` pins the request to a specific bearer token instead of the
 * usual API-key-then-session precedence. Interactive flows that already resolved
 * a Supabase session (and selected session-scoped resources like a bean) use it
 * so an exported API key for another account can't authorize the request under a
 * mismatched identity.
 */
export async function createParchmentClient(
  requiredRole: RequiredRole = 'viewer',
  tokenOverride?: string
): Promise<ParchmentClient> {
  const token = tokenOverride ?? (await resolveParchmentToken(requiredRole));
  return createSdkClient({ baseUrl: getParchmentBaseUrl(), token });
}

/**
 * Build a Parchment SDK client that authenticates when possible but never
 * requires it. An explicit API key wins; otherwise a valid local session is
 * attached if one exists; otherwise the request is anonymous. Used by the
 * `market` command family, whose public teaser slices are readable without
 * auth while entitled slices are enforced server-side (the API returns
 * 401/403, which `unwrapParchment` maps to the CLI error contract).
 */
export async function createOptionalParchmentClient(): Promise<ParchmentClient> {
  const apiKey = process.env.PARCHMENT_API_KEY || process.env.PURVEYORS_API_KEY;
  const token = apiKey || (await resolveParchmentSessionTokenIfAvailable('viewer'));
  return createSdkClient({ baseUrl: getParchmentBaseUrl(), token });
}

/** openapi-fetch result shape: `{ data?, error?, response }`. */
export interface ParchmentResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function messageFromErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }
    if (typeof record.message === 'string' && record.message.trim().length > 0) {
      return record.message;
    }
  }
  return fallback;
}

/**
 * Unwrap an SDK/openapi-fetch result, translating HTTP failures into the CLI's
 * structured error contract so exit codes and machine-mode envelopes stay
 * consistent with the rest of the CLI.
 */
export function unwrapParchment<T>(result: ParchmentResult<T>, context: string): T {
  if (result.response.ok && result.error === undefined) {
    return result.data as T;
  }

  const status = result.response.status;
  const body = result.error;

  if (status === 400) {
    // Mirror the catalog API wrapper: a 400 means the server rejected
    // user-supplied query params (bad date, over-limit, etc.), so it maps to
    // INVALID_ARGUMENT/exit 2, not the generic GENERAL_ERROR fallback below.
    // This keeps bad-input failures distinguishable from real server errors.
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      messageFromErrorBody(body, `${context}: invalid request. Check the provided arguments.`),
      body
    );
  }

  if (status === 401) {
    throw new AuthError(
      messageFromErrorBody(
        body,
        `${context} requires a valid Purveyors session or API key. Run \`purvey auth login\`, or set PARCHMENT_API_KEY/PURVEYORS_API_KEY.`
      )
    );
  }

  if (status === 403) {
    throw new AuthError(
      messageFromErrorBody(
        body,
        `${context} is not available for your plan. Your Purveyors account or API key lacks the required entitlement.`
      )
    );
  }

  if (status === 404) {
    throw new PrvrsError('NOT_FOUND', messageFromErrorBody(body, `${context}: not found.`), body);
  }

  if (status === 409) {
    throw new PrvrsError(
      'DEPENDENCY_CONFLICT',
      messageFromErrorBody(body, `${context}: conflicting state prevents this operation.`),
      body
    );
  }

  if (status === 429) {
    throw new PrvrsError(
      'GENERAL_ERROR',
      messageFromErrorBody(body, `${context}: rate limit exceeded. Try again later.`),
      body
    );
  }

  throw new PrvrsError(
    'GENERAL_ERROR',
    messageFromErrorBody(body, `${context} failed with HTTP ${status}.`),
    body
  );
}
