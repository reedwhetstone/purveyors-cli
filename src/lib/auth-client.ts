import { createParchmentClient } from '@purveyors/sdk';
import { readCredentials } from './config.js';
import { AuthError } from './errors.js';
import { getParchmentBaseUrl } from './parchment-base.js';

export interface ApiKeySession {
  apiKey: string;
  user: { id: string; email?: string; role?: string };
}

/** Local API-key context used by interactive command flows. */
export interface CredentialContext {
  getSession(): Promise<{ data: { session: ApiKeySession | null } }>;
  getUser(): Promise<{
    data: { user: ApiKeySession['user'] | null };
    error: Error | null;
  }>;
}

export async function createCredentialContext(): Promise<CredentialContext> {
  const credentials = await readCredentials();
  if (!credentials?.apiKey) {
    throw new AuthError('Not logged in. Run `purvey auth login` first.');
  }

  let identity: Awaited<ReturnType<ReturnType<typeof createParchmentClient>['me']>>;
  try {
    identity = await createParchmentClient({
      baseUrl: getParchmentBaseUrl(),
      token: credentials.apiKey,
    }).me();
  } catch (error) {
    throw new AuthError('Authentication failed. Run `purvey auth login` first.', error);
  }
  if (!identity.response.ok || identity.error || !identity.data?.authenticated) {
    throw new AuthError('Authentication failed. Run `purvey auth login` first.', identity.error);
  }

  const session: ApiKeySession = {
    apiKey: credentials.apiKey,
    user: {
      ...credentials.user,
      id: identity.data.userId ?? credentials.user.id,
      role: identity.data.primaryAppRole ?? credentials.user.role,
    },
  };
  return {
    getSession: async () => ({ data: { session } }),
    getUser: async () => ({ data: { user: session.user }, error: null }),
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
