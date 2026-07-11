import { createAuthenticatedClient } from './supabase.js';
import { AuthError } from './errors.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createParchmentClient } from '@purveyors/sdk';
import { getParchmentBaseUrl } from './parchment-base.js';

export type RequiredRole = 'viewer' | 'member';

const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  member: 1,
  'api-member': 1,
  admin: 2,
  'api-enterprise': 2,
};

/**
 * Ensure the user is authenticated and has the required role.
 * Returns the authenticated Supabase client and userId.
 *
 * - 'viewer' = any logged-in user (catalog read commands)
 * - 'member' = member role or higher (all write/personal-data commands)
 */
export async function requireAuth(
  role: RequiredRole = 'viewer'
): Promise<{ supabase: SupabaseClient; userId: string }> {
  // createAuthenticatedClient already throws AuthError when:
  //   - no credentials on disk
  //   - session is expired/revoked (with appropriate message)
  const supabase = await createAuthenticatedClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError('Authentication failed. Run `purvey auth login` first.');
  }

  // For viewer-level access we only need a valid session — no role check required.
  if (role !== 'viewer') {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new AuthError('Authentication failed. Run `purvey auth login` first.');
    }
    const result = await createParchmentClient({
      baseUrl: getParchmentBaseUrl(),
      token: session.access_token,
    }).me();
    if (!result.response.ok || result.error || !result.data?.authenticated) {
      throw new AuthError('Authentication failed. Run `purvey auth login` first.');
    }
    const userRoles = result.data.appRoles;
    const requiredLevel = ROLE_HIERARCHY[role] ?? 0;
    const hasRole = userRoles.some((r) => (ROLE_HIERARCHY[r] ?? -1) >= requiredLevel);

    if (!hasRole) {
      throw new AuthError(
        `This command requires "${role}" role or higher.\n` +
          `  Your roles: ${userRoles.length > 0 ? userRoles.join(', ') : 'none'}\n` +
          `  Upgrade at https://purveyors.io/account`
      );
    }
  }

  return { supabase, userId: user.id };
}
