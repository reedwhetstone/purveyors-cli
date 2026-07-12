import { createParchmentClient } from '@purveyors/sdk';
import { readCredentials } from './config.js';
import { AuthError } from './errors.js';
import { getParchmentBaseUrl } from './parchment-base.js';

export interface AuthSession {
  access_token: string;
  user: { id: string; email?: string; role?: string };
}

/** Minimal auth facade retained so command flows can refresh credentials at use time. */
export interface AuthClient {
  auth: {
    getSession(): Promise<{ data: { session: AuthSession | null } }>;
    getUser(): Promise<{
      data: { user: AuthSession['user'] | null };
      error: Error | null;
    }>;
  };
}

export async function createAuthenticatedClient(): Promise<AuthClient> {
  const credentials = await readCredentials();
  if (!credentials?.apiKey) {
    throw new AuthError('Not logged in. Run `purvey auth login` first.');
  }

  const session: AuthSession = {
    access_token: credentials.apiKey,
    user: credentials.user,
  };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
    },
  };
}

export async function validateSession(): Promise<{
  id: string;
  email?: string;
  role?: string;
  keyId: string;
  createdAt: string;
} | null> {
  const credentials = await readCredentials();
  if (!credentials?.apiKey) return null;

  try {
    const result = await createParchmentClient({
      baseUrl: getParchmentBaseUrl(),
      token: credentials.apiKey,
    }).me();
    if (!result.response.ok || result.error || !result.data?.authenticated) return null;
    return {
      id: result.data.userId ?? credentials.user.id,
      email: credentials.user.email,
      role:
        result.data.appRoles.length > 0
          ? result.data.appRoles.join(', ')
          : (result.data.primaryAppRole ?? credentials.user.role ?? 'authenticated'),
      keyId: credentials.keyId,
      createdAt: credentials.createdAt,
    };
  } catch {
    return null;
  }
}
