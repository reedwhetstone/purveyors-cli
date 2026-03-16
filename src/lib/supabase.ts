import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readCredentials, writeCredentials, deleteCredentials } from './config.js';
import { AuthError } from './errors.js';

/**
 * Public Supabase values — identical to what ships in every purveyors.io client bundle.
 * These are NOT secrets. The anon key only grants access through RLS policies.
 * Override via environment variables for dev/staging.
 */
const SUPABASE_URL =
  process.env.PURVEYORS_SUPABASE_URL || 'https://bjblfzfdtfvuitqdbodn.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.PURVEYORS_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqYmxmemZkdGZ2dWl0cWRib2RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgwMTQ2OTAsImV4cCI6MjA1MzU5MDY5MH0.v1YcBAxFSvEthKPp4PkV3BCAsXYJn9Z2nuJBcEfnJFo';

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
    throw new AuthError('Not logged in. Run `purvey auth login` first.');
  }

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await client.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });

  // If the session was refreshed (access token rotated), persist the new tokens
  if (!error && data.session && data.session.access_token !== creds.accessToken) {
    await writeCredentials({
      ...creds, // preserve user info
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: (data.session.expires_at ?? 0) * 1000,
    });
  }

  if (error) {
    // Refresh failed — credentials are expired
    await deleteCredentials();
    throw new AuthError('Session expired. Run `purvey auth login` to re-authenticate.');
  }

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

    // Fetch app-level role from user_roles table
    let appRoles: string[] = [];
    try {
      const { data: roleData } = await client
        .from('user_roles')
        .select('user_role')
        .eq('id', user.id)
        .single();
      if (roleData?.user_role && Array.isArray(roleData.user_role)) {
        appRoles = roleData.user_role as string[];
      }
    } catch {
      // user_roles query failed — fall back to auth role
    }

    return {
      id: user.id,
      email: user.email,
      role: appRoles.length > 0 ? appRoles.join(', ') : (user.role ?? 'authenticated'),
      expiresAt: creds.expiresAt,
    };
  } catch {
    return null;
  }
}
