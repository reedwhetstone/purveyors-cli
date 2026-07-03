import { createParchmentClient as createSdkClient, type ParchmentClient } from '@purveyors/sdk';
import { requireAuth } from './auth-guard.js';
import { AuthError, PrvrsError } from './errors.js';

const DEFAULT_PARCHMENT_BASE_URL = 'https://api.purveyors.io';

/**
 * Resolve the canonical Parchment API base URL.
 *
 * Unlike the legacy hand-rolled catalog fetch paths (which default to the
 * coffee-app BFF at www.purveyors.io), SDK-backed commands talk to the
 * canonical API directly. `PARCHMENT_API_BASE_URL` takes precedence, then the
 * shared `PURVEYORS_BASE_URL` override, then the canonical default.
 */
export function getParchmentBaseUrl(): string {
  const raw =
    process.env.PARCHMENT_API_BASE_URL ??
    process.env.PURVEYORS_BASE_URL ??
    DEFAULT_PARCHMENT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Resolve the bearer token for Parchment requests, mirroring the existing CLI
 * catalog auth pattern: an explicit API key wins, otherwise the stored Supabase
 * session JWT is used. Auth is resolved server-side against the token.
 */
export async function resolveParchmentToken(): Promise<string> {
  const apiKey = process.env.PARCHMENT_API_KEY ?? process.env.PURVEYORS_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  const { supabase } = await requireAuth('viewer');
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

/** Build an authenticated Parchment SDK client for the canonical API. */
export async function createParchmentClient(): Promise<ParchmentClient> {
  const token = await resolveParchmentToken();
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
