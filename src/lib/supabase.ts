import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readCredentials } from './config.js';
import { AuthError } from './errors.js';

/**
 * Public Supabase values — safe to ship in any client bundle.
 * Override via environment variables for dev/staging.
 */
const SUPABASE_URL = process.env.PURVEYORS_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.PURVEYORS_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing required environment variables: PURVEYORS_SUPABASE_URL and PURVEYORS_SUPABASE_ANON_KEY. ' +
      'Set them or create a .env file.'
  );
}

/**
 * Create a Supabase client with no session (anonymous/unauthenticated).
 * Used for login flows before we have a token.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Create a Supabase client initialized with stored credentials.
 * Throws AuthError if no credentials are found.
 */
export async function createAuthenticatedClient(): Promise<SupabaseClient> {
  const creds = await readCredentials();

  if (!creds) {
    throw new AuthError('Not logged in. Run `prvrs auth login` first.');
  }

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  await client.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });

  return client;
}

/**
 * Validate stored credentials by making a lightweight Supabase auth call.
 * Returns the user object if valid, null if expired/invalid.
 */
export async function validateSession(): Promise<{
  id: string;
  email?: string;
  role?: string;
  expiresAt: number;
} | null> {
  const creds = await readCredentials();
  if (!creds) return null;

  // Check expiry before hitting the network
  if (Date.now() > creds.expiresAt) {
    return null;
  }

  try {
    const client = await createAuthenticatedClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();

    if (error || !user) return null;

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      expiresAt: creds.expiresAt,
    };
  } catch {
    return null;
  }
}
