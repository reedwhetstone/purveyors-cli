# PR Verification Report: Auth & Watch Flow Audit

## Metadata

- Repos: `purveyors-cli` (PRs #21, #22) + `coffee-app` (PR #109, merged)
- Base: `6f21f83b` (CLI)
- Head: `origin/main` (CLI: `bcb5c67`, `a5eac72`)
- Reviewer model: `anthropic/claude-opus-4-6`
- Confidence: **High** (full end-to-end trace of auth, RLS, and watch flows)
- Scope: Auth correctness, watch auto-match null handling, role queries, session management

## Executive Verdict

- **Merge readiness:** Not ready (CLI PRs are fine; coffee-app endpoint has a blocking bug for CLI callers)
- Intent coverage: Full (PRs #21 and #22 implement what they claim)
- Priority summary: **P0: 1, P1: 1, P2: 3, P3: 2**

## Intent Verification

### PR #21 (CLI): Auto-match null handling + form spinners

- **Stated:** Fix `result.match` null/undefined handling; add clack spinners to all form submissions
- **Implemented:** ✅ `classifyRoast()` now normalizes with `data.match ?? null`. Watch check changed from `=== null` to `!result.match`. Spinners added to inventory add, roast create, roast import, sale record, and tasting rate.
- **Coverage gaps:** None

### PR #22 (CLI): Auth status role from `user_roles` table

- **Stated:** Query `user_roles.user_role` array instead of showing Supabase's generic `authenticated` role
- **Implemented:** ✅ `validateSession()` queries `user_roles.user_role`, falls back to `user.role ?? 'authenticated'` if no row or query fails
- **Coverage gaps:** None

### PR #109 (coffee-app, merged): classify-roast auth change

- **Stated:** Change from `requireMemberRole()` to `requireAuth()` + manual role check
- **Implemented:** ✅ Uses `requireAuth(event)` for Bearer token validation, then manual role check against `user_roles.user_role` array
- **Coverage gaps:** The role check uses the wrong Supabase client (see P0 below)

---

## Auth Flow End-to-End Trace

### 1. `purvey auth login` → credential storage

**Flow:** Google OAuth → local callback server (random port on localhost) → browser receives tokens in URL fragment → JS POSTs tokens to `/auth/token` → CLI persists to `~/.config/purvey/credentials.json` (mode 0o600).

**Stored shape:** `{ accessToken, refreshToken, expiresAt (ms), user: { id, email, role } }`

**Assessment:** ✅ Clean. File permissions are restrictive. Legacy migration from `~/.config/prvrs/` included.

### 2. `createAuthenticatedClient()` → Supabase client reconstruction

**Flow:**

1. Reads credentials from disk
2. Creates anon client (no session)
3. Calls `client.auth.setSession({ access_token, refresh_token })`
4. `setSession()` validates the JWT and auto-refreshes if expired
5. If tokens were rotated, persists new tokens to disk
6. If refresh fails entirely, deletes credentials and throws `AuthError`

**Assessment:** ✅ Correct. The `setSession()` call properly establishes the user's session on the client, so `auth.uid()` works for RLS. Automatic refresh on every command means tokens stay fresh during active use.

### 3. CLI Supabase queries → RLS context

**When the CLI queries** (e.g., `listInventory`): The client from `createAuthenticatedClient()` has a valid session. PostgREST receives the JWT in the Authorization header, sets `auth.uid()` = user's UUID, and applies RLS policies.

**RLS policies verified:**

- `green_coffee_inv`: `SELECT USING (auth.uid() = "user")` ✅
- `user_roles`: `SELECT USING (auth.uid() = id)` ✅

**Is `userId` parameter needed in `listInventory(supabase, userId)`?** Technically redundant since RLS enforces `auth.uid() = "user"`. However, the explicit `.eq('user', userId)` is defense-in-depth and harmless. Removing it would still work, but keeping it documents intent.

### 4. CLI → classify-roast HTTP call

**Flow in `classifyRoast()`:**

1. Gets current session from Supabase client: `supabase.auth.getSession()`
2. Throws if no session
3. Sends `POST /api/ai/classify-roast` with `Authorization: Bearer ${session.access_token}`

**Assessment:** ✅ Correct token transmission.

### 5. classify-roast endpoint auth (⚠️ P0 BUG)

See P0 finding below.

### 6. Session/token management

- **Access token TTL:** ~1 hour (Supabase default)
- **Refresh token TTL:** Project-dependent (typically 7-30 days)
- **Refresh flow:** `setSession()` in `createAuthenticatedClient()` auto-refreshes on every CLI command. New tokens are persisted.
- **Refresh failure:** Credentials deleted, user must re-login. Error message is clear.
- **No proactive expiry warning:** The CLI only discovers expiry when the user runs a command. Acceptable for a CLI tool.

---

## Findings by Severity

### P0 (must fix before merge)

#### classify-roast role check uses wrong Supabase client for CLI requests

**Evidence:**

- `coffee-app/src/routes/api/ai/classify-roast/+server.ts`, line 41: `const { supabase } = event.locals;`
- `coffee-app/src/hooks.server.ts`: `event.locals.supabase` is created via `createServerClient()` with cookie-based auth
- CLI sends Bearer token in Authorization header, NOT cookies

**Trace:**

1. CLI sends `POST /api/ai/classify-roast` with `Authorization: Bearer <token>` (no cookies)
2. hooks.server.ts runs → `createServerClient()` with empty cookies → no session
3. `event.locals.supabase` has no authenticated session; `auth.uid()` = null
4. `requireAuth(event)` succeeds (validates Bearer token via module-level client) → returns `user`
5. Endpoint queries `event.locals.supabase.from('user_roles').select('user_role').eq('id', user.id)`
6. RLS policy: `SELECT USING (auth.uid() = id)` → `auth.uid()` is null → 0 rows returned
7. `roleData` is null → `userRoles` = `[]` → no allowed role found → **returns 403**

**Impact:** CLI's classify-roast calls will ALWAYS get 403, making the entire watch auto-match feature non-functional. Web requests work because browsers send cookies alongside the Bearer token.

**Correction:** The role query in classify-roast needs a Supabase client that has the user's session. Options:

1. Create a temporary Supabase client in the endpoint, call `setSession()` with the Bearer token, use that for the role query
2. Use a service-role client for the role lookup (since the user is already validated by `requireAuth`)
3. Refactor `requireAuth` to also set the session on `event.locals.supabase`

Option 2 is cleanest since it separates authn (user validation) from authz (role lookup; admin operation).

### P1 (should fix before merge)

#### Role name format mismatch: underscores vs hyphens

**Evidence:**

- `classify-roast/+server.ts` line 48: `const allowed = ['member', 'admin', 'api_member', 'api_enterprise'];`
- `auth.types.ts`: `export type UserRole = 'viewer' | 'member' | 'api-member' | 'api-enterprise' | 'admin';`
- `database.types.ts` line 1198: enum values use underscores (`api_member`, `api_enterprise`)

**Impact:** If the database stores hyphenated values (`api-member`) matching the TypeScript type, the underscore check in classify-roast would never match API-tier users. If the database stores underscored values matching the auto-generated types, the `checkRole` function in `auth.types.ts` would break for those roles. One of these paths is wrong.

**Correction:** Audit the actual database values (run `SELECT DISTINCT unnest(user_role) FROM user_roles`). Standardize on one format everywhere: TypeScript types, allowed arrays, and database values.

### P2 (important improvements)

#### No explicit 401 handling in CLI's `classifyRoast()`

**Evidence:** `purveyors-cli/src/lib/ai.ts` handles 403 and 429 specifically, but 401 falls through to generic `AI classification failed: ${response.statusText}`.

**Impact:** If the user's token expires mid-session (e.g., during a long watch), the error message is unhelpful. Should say "Session expired. Run `purvey auth login` first."

**Correction:** Add `if (response.status === 401) { throw new Error('Session expired...'); }` before the generic handler.

#### Module-level `createBrowserClient()` singleton in server auth

**Evidence:** `coffee-app/src/lib/server/auth.ts` line 7: `const supabase = createClient();` (module-level, shared across all requests)

**Impact:** `createBrowserClient()` is designed for browser environments. Using it as a module-level singleton on the server is architecturally fragile. Currently works because `getUser(token)` is stateless, but any future use of this client for session-dependent operations would silently share state across requests.

**Correction:** Create the client inside `requireAuth()` or use `createServerClient` from `@supabase/ssr`.

#### Stored credentials don't reflect app roles

**Evidence:** `StoredCredentials.user.role` stores the Supabase auth role (`authenticated`) at login time. PR #22 only updates the displayed role via `validateSession()`, not the stored value in credentials.json.

**Impact:** Minor inconsistency; the stored `role` field is never used for authorization decisions (always re-fetched). But it's stale data sitting on disk.

**Correction:** Update stored credentials role during `validateSession()` when app roles are fetched, or remove the `role` field from `StoredCredentials.user`.

### P3 (nice to have)

#### Redundant userId filter in inventory queries

**Evidence:** `listInventory()` uses `.eq('user', userId)` but RLS already enforces `auth.uid() = "user"`.

**Assessment:** Defense-in-depth. No action needed, but worth documenting as intentional.

#### Token expiry display uses initial login timestamp

**Evidence:** `validateSession()` returns `expiresAt: creds.expiresAt` (from initial login), but `createAuthenticatedClient()` may have refreshed the token (updating stored credentials). The `validateSession()` re-reads from disk after calling `createAuthenticatedClient()` but uses the `creds` variable captured before the refresh.

**Impact:** Displayed expiry time could be stale by the duration of one token lifetime (~1 hour). Cosmetic only.

---

## Assumptions Review

| Assumption                                                   | Validity    | Notes                                                                             |
| ------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------- |
| `setSession()` properly refreshes expired access tokens      | **Valid**   | Supabase JS v2 `setSession()` uses refresh token automatically                    |
| RLS on `user_roles` allows self-read with valid session      | **Valid**   | Policy: `SELECT USING (auth.uid() = id)`, confirmed in schema                     |
| `event.locals.supabase` has user session for all API callers | **Invalid** | Only true for cookie-based requests (web app), NOT for Bearer-only requests (CLI) |
| `user_role` column contains array values                     | **Valid**   | Schema: `text[] NOT NULL DEFAULT '{viewer}'`                                      |
| `data.match ?? null` correctly normalizes undefined          | **Valid**   | Nullish coalescing converts undefined to null                                     |
| `!result.match` catches both null and undefined              | **Valid**   | Falsy check covers both cases                                                     |

## Tech Debt Notes

- **Debt introduced:** None by PRs #21/#22. PR #109 introduced the P0 (wrong client for role check).
- **Debt worsened:** The module-level `createBrowserClient()` in server auth was pre-existing; PR #109 added a new consumer of it without addressing the pattern.
- **Suggested follow-up tickets:**
  1. Fix classify-roast to use service-role or session-aware client for role queries
  2. Standardize role name format (underscores vs hyphens) across codebase
  3. Replace module-level `createBrowserClient()` in server auth with proper server client

## Product Alignment Notes

- **Alignment wins:** Spinners improve perceived responsiveness. Role display shows meaningful app roles instead of generic `authenticated`. Auto-match null fix prevents silent failures.
- **Misalignments:** The auto-match feature (core UX of watch mode) is broken for CLI users due to the P0.

## Test Coverage Assessment

- **Existing tests:** None found for classify-roast endpoint or CLI auth flow
- **Missing tests:**
  1. Integration test: CLI Bearer token → classify-roast → role check → response
  2. Unit test: `classifyRoast()` response normalization (null, undefined, valid match)
  3. Unit test: `validateSession()` with/without `user_roles` row
- **Suggested test additions:**
  1. Mock classify-roast endpoint test verifying Bearer-only (no cookies) requests pass role check
  2. Test `runAutoMatch()` error handling for 401, 403, 500 responses

## Minimal Correction Plan

1. **[P0, coffee-app]** Fix classify-roast role query to use a Supabase client with the validated user's session, or use service-role client for the role lookup
2. **[P1, coffee-app]** Audit and standardize role name format (`api_member` vs `api-member`) across classify-roast allowed list, auth.types.ts, and database values
3. **[P2, CLI]** Add explicit 401 handling in `classifyRoast()` with a "session expired" message

## Optional Patch Guidance

### P0 Fix (classify-roast/+server.ts)

Replace the role check section with a service-role or token-aware client:

```typescript
// Option A: Create a client with the user's token for the role query
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';

// Use service role to bypass RLS for role lookup (user already validated)
const adminClient = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: roleData } = await adminClient
  .from('user_roles')
  .select('user_role')
  .eq('id', user.id)
  .single();
```

### P1 Fix (classify-roast/+server.ts)

```typescript
// Standardize to match auth.types.ts format (hyphens)
const allowed = ['member', 'admin', 'api-member', 'api-enterprise'];
```

(Or standardize the other direction; depends on what's in the database.)

### P2 Fix (CLI ai.ts)

```typescript
if (response.status === 401) {
  throw new Error('Session expired. Run `purvey auth login` to re-authenticate.');
}
```
