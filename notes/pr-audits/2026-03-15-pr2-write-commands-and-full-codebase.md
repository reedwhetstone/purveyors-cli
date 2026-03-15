# PR Verification Report — PR #2 + Full Codebase Audit

## Metadata

- **Repo:** reedwhetstone/purveyors-cli
- **Base:** origin/main (e34b40a)
- **Head:** origin/feat/write-commands (4c70d49)
- **PR:** #2
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Full codebase holistic audit (2 PRs total in project history) plus focused review of PR #2 changes (write commands, prompts, vitest env config)

---

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 1, P1: 4, P2: 5, P3: 3

The codebase is well-structured, consistent, and thoughtfully designed for a Phase 2 CLI. The PR delivers exactly what it promises: write commands for inventory, roast, sales, and tasting. Code quality is high. The issues found are primarily around security hardening, token lifecycle management, and SQL injection via PostgREST filter strings.

---

## Intent Verification

- **Stated intent:** Add write commands (inventory add/update/delete, roast create/delete, sales CRUD, tasting rate). Hardcode prod Supabase URL and anon key for zero-config install.
- **What was implemented:** All write commands implemented with proper validation, ownership checks, confirmation prompts for deletes, and re-fetch-after-write patterns. Supabase config was changed to require env vars (not hardcoded), which diverges from stated intent but is the correct security choice. New `prompts.ts` utility added. Tests added for validation helpers.
- **Coverage gaps:**
  - The PR description says "hardcodes prod Supabase URL and anon key" but the actual implementation uses env vars (`PURVEYORS_SUPABASE_URL`, `PURVEYORS_SUPABASE_ANON_KEY`) with a hard crash if they're missing. This is better than hardcoding, but means users can't `npm install -g` and immediately use it. The README documents the env vars. This gap should be intentional; verify with Reed.
  - `sales` command was listed in PR intent and is fully implemented (CRUD), though it wasn't in the initial PR #1 read commands. Good scope addition.

---

## Findings by Severity

### P0 (must fix before merge)

#### 1. PostgREST Filter Injection via User-Supplied Strings

- **Evidence:** `src/commands/catalog.ts` lines in search action:
  ```typescript
  query = query.or(`country.ilike.%${o}%,continent.ilike.%${o}%,region.ilike.%${o}%`);
  ```
  and the flavor filter:
  ```typescript
  const flavorFilters = keywords
    .flatMap((kw) => [
      `description_short.ilike.%${kw}%`,
      ...
    ])
    .join(',');
  query = query.or(flavorFilters);
  ```
- **Impact:** User-supplied `--origin` and `--flavor` values are interpolated directly into PostgREST filter strings. A malicious input like `%,id.gt.0` could break out of the intended filter, potentially exposing data through filter manipulation. While `coffee_catalog` is publicly readable so the data exposure risk is low here, this establishes a dangerous pattern that could be copied to authenticated endpoints.
- **Correction:** Sanitize filter inputs by stripping or escaping PostgREST special characters (`.`, `,`, `(`, `)`, `%`, `*`). Or use multiple chained `.ilike()` calls instead of raw `.or()` string interpolation. The Supabase JS SDK supports this:
  ```typescript
  query = query.or(
    `country.ilike.%${sanitize(o)}%,continent.ilike.%${sanitize(o)}%,region.ilike.%${sanitize(o)}%`
  );
  ```
  Where `sanitize()` strips/escapes `,` and `.` from user input.

### P1 (should fix before merge)

#### 2. No Token Refresh Mechanism

- **Evidence:** `src/lib/supabase.ts` — `createAuthenticatedClient()` sets `autoRefreshToken: false` and uses `setSession()` with stored tokens. `validateSession()` checks `Date.now() > creds.expiresAt` but no code path refreshes the token using the stored `refreshToken`.
- **Impact:** Tokens expire (default 1 hour in Supabase). After expiry, every authenticated command fails with "Not logged in." The user must re-authenticate via browser every hour. For a CLI tool used in scripts/cron, this is a significant UX problem.
- **Correction:** Add a `refreshSession()` function that calls `supabase.auth.refreshSession({ refresh_token: creds.refreshToken })` when the access token is expired or near-expiry, then persists the new credentials. Call it inside `createAuthenticatedClient()` before returning.

#### 3. `cupping_notes` Written as JSON String Instead of JSONB Object

- **Evidence:** `src/commands/tasting.ts` — rate action:
  ```typescript
  const { error: updateError } = await supabase
    .from('green_coffee_inv')
    .update({ cupping_notes: JSON.stringify(cupping) })
    .eq('id', inventoryId)
    .eq('user', user.id);
  ```
- **Impact:** If `cupping_notes` is a JSONB column in Postgres (likely, given the naming convention and the fact that it stores structured data), passing `JSON.stringify(cupping)` writes a JSON _string_ into the column rather than a JSONB object. This means queries like `cupping_notes->>'aroma'` would fail because the column contains a string, not a JSON object. The Supabase JS SDK handles JSONB serialization automatically; just pass the object directly.
- **Correction:** Change to `{ cupping_notes: cupping }` (remove the `JSON.stringify` wrapper).

#### 4. Missing `--pretty` and `--csv` Global Options on Parent Commands

- **Evidence:** The `auth status` command manually adds `--pretty` and `--csv` options. But for all other commands (inventory list, roast list, sales list, etc.), there's no explicit `--pretty` or `--csv` option declared. The code calls `cmd.optsWithGlobals()` expecting these, but they're never registered on the parent `program` or on individual subcommands (except `auth status`).
- **Impact:** Running `prvrs inventory list --pretty` would have `--pretty` silently ignored (Commander ignores unknown options by default) or error depending on Commander version. The output format feature documented in README doesn't actually work for most commands.
- **Correction:** Add `--pretty` and `--csv` as global options on the root `program` command in `src/index.ts`:
  ```typescript
  program.option('--pretty', 'Pretty-print JSON output').option('--csv', 'Output as CSV');
  ```
  This makes them available via `optsWithGlobals()` in all subcommands.

#### 5. Ownership Verification Relies Solely on Client-Side `user.id` Filtering

- **Evidence:** All write commands (inventory update/delete, roast delete, sales update/delete) verify ownership by doing a separate SELECT with `.eq('user', user.id)` before the mutation, then also include `.eq('user', user.id)` on the mutation itself. This is correct at the application level, but there's no evidence that Supabase Row Level Security (RLS) is configured on these tables.
- **Impact:** If RLS is not enabled (or policies are permissive), a modified client could skip the ownership check and mutate any user's data. The CLI is open-source; anyone can fork it and remove the ownership checks. The actual security boundary must be RLS, not application code.
- **Correction:** Verify that RLS policies exist on `green_coffee_inv`, `roast_profiles`, `sales`, and `roast_temperatures` tables that restrict INSERT/UPDATE/DELETE to `auth.uid() = user`. Document this in AGENTS.md or a security note. If RLS is already configured in coffee-app's Supabase project, note it and link to the migration files.

### P2 (important improvements)

#### 6. Module-Level Environment Variable Crash

- **Evidence:** `src/lib/supabase.ts`:

  ```typescript
  const SUPABASE_URL = process.env.PURVEYORS_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.PURVEYORS_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing required environment variables...');
  }
  ```

- **Impact:** This runs at module import time, not at command execution time. Running `prvrs --help` or `prvrs --version` throws an unformatted error if env vars aren't set. The CI workaround (placeholder values in vitest.config.ts) confirms this is a pain point. For a user who just installed the CLI and wants to see help, this is a bad first experience.
- **Correction:** Move the validation into `createAnonClient()` and `createAuthenticatedClient()` so that env vars are only required when actually making Supabase calls. This lets `--help` and `--version` work without configuration. The vitest placeholder workaround can then be removed.

#### 7. No `.env` File Loading

- **Evidence:** README says "Create a `.env` file" but there's no `dotenv` dependency or any code that loads `.env` files. The `pnpm dev` script uses `tsx` which doesn't auto-load `.env`.
- **Impact:** Users following the README's development instructions will set up a `.env` file that's never read, leading to the env var crash from P2-6.
- **Correction:** Either add `dotenv` as a dependency (loaded early in `index.ts`), use `tsx --env-file=.env` in the dev script, or update the README to say "export these variables in your shell" instead of "create a .env file."

#### 8. `sales` Command Uses Table Name `sales` Without Confirmation of Schema

- **Evidence:** `src/commands/sales.ts` queries `supabase.from('sales')` and joins with `roast_profiles!roast_id`. The Sale type has fields like `oz_sold`, `sale_price`, `buyer`, `sell_date`.
- **Impact:** If the actual table in coffee-app's Supabase is named differently (e.g., `coffee_sales`), or has different column names, every sales command will fail at runtime. No test validates this against the actual schema.
- **Correction:** Verify the table name and column names against the actual Supabase schema. Consider adding a schema validation test or at minimum documenting the expected schema in AGENTS.md.

#### 9. `tasting rate` Command's `bean-id` Argument Is Confusing

- **Evidence:** `tasting get <bean-id>` accepts a `coffee_catalog` ID, while `tasting rate <bean-id>` accepts a `green_coffee_inv` ID. Both use the same `<bean-id>` positional argument name.
- **Impact:** A user who successfully runs `tasting get 42` (catalog ID 42) and then runs `tasting rate 42` expecting to rate the same bean will actually be rating inventory item 42, which may be a completely different bean. The error message says "Pass a green_coffee_inv ID" but only after the command fails.
- **Correction:** Rename the `rate` argument to `<inventory-id>` to make the distinction clear:
  ```
  prvrs tasting rate <inventory-id> --aroma 4 --body 3 ...
  ```
  Update help text accordingly.

#### 10. Duplicate User Auth Check Pattern (DRY Violation)

- **Evidence:** Every authenticated command repeats:
  ```typescript
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AuthError('Not logged in. Run `prvrs auth login` first.');
  }
  ```
- **Impact:** This 5-line block appears ~15 times across the codebase. If the error message or logic changes, every call site needs updating. This violates the "Never Repeat Truth" principle from AGENTS.md.
- **Correction:** Extract a helper:
  ```typescript
  async function requireUser(supabase: SupabaseClient): Promise<User> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AuthError('Not logged in. Run `prvrs auth login` first.');
    return user;
  }
  ```
  Put it in `supabase.ts` or a new `auth-helpers.ts`. All commands call `const user = await requireUser(supabase)`.

### P3 (nice to have)

#### 11. No `--force` or `--dry-run` Options on Write Commands

- **Evidence:** Write commands have `--yes` for skipping confirmation on deletes, but no `--dry-run` to preview what would be written.
- **Impact:** Minor. Scripts that want to validate inputs before committing can't do a dry run. Not critical for Phase 2.
- **Correction:** Consider adding `--dry-run` to write commands in a future phase. Low priority.

#### 12. `roast create` Default Batch Name Uses Em Dash

- **Evidence:** `src/commands/roast.ts`:
  ```typescript
  batchName = `${coffeeName} — ${roastDate}`;
  ```
- **Impact:** Minor stylistic issue. The codebase owner dislikes em dashes (per SOUL.md/USER.md). This generates user-visible data with an em dash in it.
- **Correction:** Use a different separator: `${coffeeName} - ${roastDate}` or `${coffeeName} | ${roastDate}`.

#### 13. Test Coverage Is Validation-Only; No Integration Tests

- **Evidence:** All tests are pure-function unit tests (computeCatalogStats, isValidCuppingScore, parseCuppingScore, todayIso, output formatting, confirm logic). No tests exercise the actual command handlers even with mocked Supabase.
- **Impact:** Command handler bugs (wrong column names, broken joins, incorrect insert payloads) won't be caught until manual testing against a live database. This is acceptable for Phase 2 but should be addressed before a public release.
- **Correction:** Add command handler tests with a mocked Supabase client. Vitest's mocking capabilities can intercept `createAuthenticatedClient()` to return a fake client that records queries.

---

## Assumptions Review

| Assumption                                            | Validity  | Why                                                                          | Action                                                                        |
| ----------------------------------------------------- | --------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Supabase RLS restricts writes to `auth.uid() = user`  | **Weak**  | No evidence in this repo; RLS is configured in coffee-app's Supabase project | Verify RLS policies exist for all tables the CLI writes to                    |
| `cupping_notes` column on `green_coffee_inv` is JSONB | **Weak**  | Assumed from name/usage, but type not confirmed                              | Verify column type; if text, `JSON.stringify` is correct; if JSONB, remove it |
| `sales` table exists with the expected schema         | **Weak**  | No schema migration files in this repo                                       | Verify against live schema or coffee-app migrations                           |
| `coffee_catalog` is publicly readable (no RLS)        | **Valid** | Catalog uses `createAnonClient()` and works without auth                     | N/A                                                                           |
| Users have a browser for OAuth login                  | **Valid** | CLI prints URL as fallback for headless environments                         | N/A                                                                           |
| Supabase anon key is safe to expose in client code    | **Valid** | Supabase design: anon key is public, RLS provides security                   | N/A (but confirm RLS is active)                                               |
| Node.js >= 20 is available                            | **Valid** | Documented in package.json engines field                                     | N/A                                                                           |

---

## Tech Debt Notes

- **Debt introduced:**
  - Repeated auth-check pattern (~15 instances) creates maintenance burden
  - Local type definitions that may drift from actual database schema
  - No schema synchronization strategy between CLI and coffee-app

- **Debt worsened:**
  - None significant; the PR follows existing patterns faithfully

- **Suggested follow-up tickets:**
  1. Extract `requireUser()` helper to eliminate auth-check duplication
  2. Add token refresh flow for long-running/scripted usage
  3. Implement PostgREST filter sanitization
  4. Add integration tests with mocked Supabase client
  5. Lazy-load env var validation so `--help`/`--version` work without config
  6. Consider auto-generating types from Supabase schema (via `supabase gen types`)

---

## Type Alignment Strategy: CLI vs coffee-app

**Current state:** The CLI defines its own local TypeScript interfaces in each command file (`CatalogItem`, `InventoryItem`, `RoastProfile`, `Sale`, `SupplierTastingNotes`, etc.) and in `src/types/index.ts` (`StoredCredentials`, `OutputOptions`, `GlobalOptions`). These are hand-written based on knowledge of the database schema.

**coffee-app alignment:** There is no shared type package, no auto-generation from Supabase schema, and no explicit synchronization mechanism. The CLI types are a manual subset of whatever the Supabase tables look like, with nullable annotations that may or may not match reality.

**Risk:** When coffee-app evolves its schema (adds columns, renames fields, changes types), the CLI types will silently drift. The CLI won't break at compile time; it will break at runtime when it queries columns that no longer exist or expects types that have changed.

**Recommendation:**

1. **Short-term (before v1.0):** Use `supabase gen types typescript` to generate types from the live schema into a shared `src/types/database.ts` file. Import table row types from there instead of hand-writing interfaces.
2. **Medium-term:** Create a shared `@purveyors/types` package consumed by both coffee-app and the CLI. Publish it as part of CI.
3. **CI check:** Add a CI step that runs `supabase gen types` and diffs against the committed types file. If they diverge, CI fails, forcing type updates.

---

## Product Alignment Notes

- **Alignment wins:**
  - Clean separation of public (catalog) vs authenticated (everything else) commands
  - Output format strategy (compact JSON default, --pretty, --csv) is well-suited for power users and scripting
  - Confirmation prompts on destructive actions show care for UX
  - Re-fetch-after-write pattern gives immediate feedback on what was created/updated
  - stderr for messages / stdout for data is the Unix-correct approach

- **Misalignments:**
  - Zero-config install goal (stated in PR intent) is not met; env vars are required
  - `tasting get` vs `tasting rate` use different ID spaces with the same argument name

- **Suggested product checks:**
  - Verify the sales table/feature is something users actually need in the CLI
  - Consider whether `roast import-artisan` (Phase 3 TODO) should block the CLI's first public release

---

## Test Coverage Assessment

- **Existing tests that validate changes:**
  - `write-commands.test.ts`: cupping score validation (isValidCuppingScore, parseCuppingScore)
  - `prompts.test.ts`: todayIso date formatting, confirm answer-parsing logic
  - `catalog.test.ts`: computeCatalogStats pure function (comprehensive edge cases)
  - `output.test.ts`: outputData in all three modes, success/info/warn helpers
  - `tasting.test.ts`: filter validation

- **Missing tests:**
  - No tests for any command handler (even with mocked I/O)
  - No tests for `createAuthenticatedClient()` or `createAnonClient()` behavior
  - No tests for error handling wrapper behavior (withErrorHandling)
  - No tests for config read/write/delete operations
  - No tests for the OAuth callback server logic

- **Suggested test additions (prioritized):**
  1. Mock-Supabase integration tests for at least one CRUD cycle (inventory add -> list -> update -> delete)
  2. Config read/write/delete tests (use temp directory)
  3. Error handling wrapper tests (verify it catches and formats errors)

---

## Minimal Correction Plan

1. **P0-1:** Sanitize PostgREST filter inputs in catalog search to prevent filter injection
2. **P1-2:** Add token refresh logic in `createAuthenticatedClient()` when access token is expired
3. **P1-3:** Fix `tasting rate` to pass cupping object directly instead of `JSON.stringify` (verify column type first)
4. **P1-4:** Register `--pretty` and `--csv` as global options on the root program command
5. **P1-5:** Verify RLS policies exist on all writable tables; document the security model

---

## Optional Patch Guidance

### P0-1: Filter Sanitization

Add to `src/lib/` or inline in catalog.ts:

```typescript
function sanitizeFilterValue(input: string): string {
  // Strip PostgREST filter operators that could break out of ilike context
  return input.replace(/[.,()]/g, '');
}
```

Apply to all user inputs before interpolation into `.or()` strings.

### P1-2: Token Refresh

In `supabase.ts`, modify `createAuthenticatedClient()`:

```typescript
export async function createAuthenticatedClient(): Promise<SupabaseClient> {
  let creds = await readCredentials();
  if (!creds) throw new AuthError('Not logged in. Run `prvrs auth login` first.');

  // Refresh if expired or within 5 minutes of expiry
  if (Date.now() > creds.expiresAt - 5 * 60 * 1000) {
    const client = createAnonClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: creds.refreshToken,
    });
    if (error || !data.session) {
      throw new AuthError('Session expired. Run `prvrs auth login` to re-authenticate.');
    }
    creds = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: Date.now() + (data.session.expires_in ?? 3600) * 1000,
      user: creds.user,
    };
    await writeCredentials(creds);
  }

  const client = createAnonClient();
  await client.auth.setSession({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });
  return client;
}
```

### P1-4: Global Options

In `src/index.ts`:

```typescript
program.option('--pretty', 'Pretty-print JSON output').option('--csv', 'Output as CSV');
```

### P2-12: Em Dash Fix

In `src/commands/roast.ts`:

```typescript
batchName = `${coffeeName} - ${roastDate}`;
```
