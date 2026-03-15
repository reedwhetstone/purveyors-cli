# PR Verification Report — PR #8 + Full Codebase Audit

## Metadata

- **Repo:** reedwhetstone/purveyors-cli
- **Base:** origin/main (e86827a)
- **Head:** origin/chore/rename-cli-purvey (e748d65)
- **PR:** #8
- **Reviewer model:** anthropic/claude-opus-4-6
- **Confidence:** High
- **Scope note:** Full codebase audit (8 PRs total). Focused diff review for PR #8 (rename `prvrs` -> `purvey`) plus comprehensive review of all source, tests, CI, packaging, security, and documentation.

---

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Partial (one missed rename + missing migration path)
- **Priority summary:** P0: 0, P1: 3, P2: 6, P3: 5

The rename PR is mechanically correct for the primary paths. The codebase is well-structured, consistent, and thoughtfully designed. However, the rename is incomplete (3 residual `prvrs`/`PRVRS` references), there's no migration path for existing users' credentials, and the npm publish workflow is missing its auth token. The pre-existing issues from the PR #2 audit (callback server security, PostgREST sanitization gaps) remain unaddressed.

---

## Intent Verification

- **Stated intent:** Rename CLI binary from `prvrs` to `purvey`, update config dir from `~/.config/prvrs/` to `~/.config/purvey/`, fix docs link (purveyors.io/docs/cli -> GitHub repo), bump version to 0.2.0.
- **What was implemented:** Binary name changed in package.json `bin` field, Commander `.name()`, all help examples, all error messages, README, AGENTS.md. Config dir updated in `config.ts`. Docs link fixed. Version bumped.
- **Coverage gaps:**
  1. `PRVRS_DEBUG` env var not renamed (in `src/lib/errors.ts:35,40`, `README.md:127`, `AGENTS.md:69`)
  2. `.gitignore` still references `~/.config/prvrs/` (line 7)
  3. Error class names still use `PrvrsError` prefix (deliberate? Should be documented if so)
  4. No migration for existing `~/.config/prvrs/credentials.json` -> `~/.config/purvey/credentials.json`

---

## Findings by Severity

### P0 (must fix before merge)

None.

### P1 (should fix before merge)

#### P1-1: Incomplete rename — `PRVRS_DEBUG` env var still uses old name

- **Evidence:** `src/lib/errors.ts:35,40` checks `process.env.PRVRS_DEBUG`. `README.md:127` and `AGENTS.md:69` document it as `PRVRS_DEBUG`.
- **Impact:** Inconsistent branding. Users see `purvey` everywhere but must set `PRVRS_DEBUG` for debug output. This will be confusing for new users and is a missed rename.
- **Correction:** Rename to `PURVEY_DEBUG` (or `PURVEYORS_DEBUG` to match the `PURVEYORS_SUPABASE_*` pattern). Update all three locations plus vitest env config if applicable.

#### P1-2: No credential migration path from `~/.config/prvrs/` to `~/.config/purvey/`

- **Evidence:** `src/lib/config.ts:7` changed from `~/.config/prvrs` to `~/.config/purvey`. No migration code exists.
- **Impact:** Any existing user who authenticated with v0.1.x will silently lose their session on upgrade. `purvey auth status` will say "Not logged in" with no indication that credentials exist at the old path. For a v0.2.0 with potentially few users this may be acceptable, but it's bad UX.
- **Correction:** Add a one-time migration check in `readCredentials()`: if `~/.config/purvey/credentials.json` doesn't exist but `~/.config/prvrs/credentials.json` does, copy it (or move it) to the new location and print a stderr message (`info('Migrated credentials from ~/.config/prvrs/ to ~/.config/purvey/')`). Alternatively, document the breaking change in a CHANGELOG or README migration section and accept the forced re-login.

#### P1-3: npm publish workflow missing `NODE_AUTH_TOKEN`

- **Evidence:** `.github/workflows/publish.yml` runs `npx npm@latest publish --access public --provenance` but never sets `NODE_AUTH_TOKEN` or `NPM_TOKEN` environment variable.
- **Impact:** The publish step will fail with a 401/403 every time a `v*` tag is pushed. The workflow has never successfully published.
- **Correction:** Add `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step. Ensure the `NPM_TOKEN` secret is configured in the repository.

### P2 (important improvements)

#### P2-1: `.gitignore` still references old config path

- **Evidence:** `.gitignore:7` contains `~/.config/prvrs/`. Should be `~/.config/purvey/`.
- **Impact:** Cosmetic inconsistency. The `.gitignore` entry is also ineffective since `~/.config/` is outside the repo tree; this line does nothing regardless of path.
- **Correction:** Update to `~/.config/purvey/` for consistency, or remove the line entirely since it has no effect.

#### P2-2: OAuth callback server has no timeout

- **Evidence:** `src/commands/auth.ts` — `startCallbackServer()` creates an HTTP server and returns a `tokenPromise`, but there's no timeout. If the user closes the browser or the OAuth flow fails silently, the CLI hangs forever.
- **Impact:** User must Ctrl+C to exit a stuck login flow. The ora spinner will spin indefinitely.
- **Correction:** Add a timeout (e.g., 120 seconds) that rejects the `tokenPromise` and closes the server with a helpful error message.

#### P2-3: OAuth callback server binds to all requests on localhost, no CSRF protection

- **Evidence:** `src/commands/auth.ts:63-108` — The `/auth/token` POST endpoint accepts any JSON body from any origin. A malicious page could POST crafted tokens to `http://localhost:<port>/auth/token` if it can guess the port.
- **Impact:** Low practical risk (random ephemeral port, short window), but a determined attacker on the same machine could inject tokens. Standard OAuth CLIs use a `state` parameter to prevent this.
- **Correction:** Generate a random `state` nonce, include it in the OAuth URL and the callback page, verify it in the `/auth/token` handler before accepting tokens.

#### P2-4: PostgREST filter sanitization doesn't strip `%` (wildcard)

- **Evidence:** `src/commands/catalog.ts:15` — `sanitizeFilterValue()` strips `( ) , . *` but not `%`. The `%` character is a SQL/PostgREST wildcard used in `ilike` patterns.
- **Impact:** A user searching `--origin "%"` would match all rows (since `ilike.%%` matches everything). This isn't a security vulnerability per se (the catalog is public, and the user is querying their own CLI), but it's inconsistent with the stated intent of preventing "injection into `.or()` filter strings."
- **Correction:** Add `%` to the character class: `/[(),.*%]/g`. Consider also stripping `_` (single-char SQL wildcard).

#### P2-5: `database.types.ts` is empty/stub — not providing type safety

- **Evidence:** `src/types/database.types.ts` exports `Database` with all `Record<string, never>` entries. The typegen workflow exists but has apparently never been run, or the Supabase project returns empty types.
- **Impact:** The generated types provide zero type safety. All Supabase queries use runtime types from hand-written interfaces in each command file. If a column is renamed or removed in the database, TypeScript won't catch it.
- **Correction:** Run the typegen workflow to populate real types. Then gradually wire up `SupabaseClient<Database>` typing for compile-time safety. Not blocking for this PR, but should be a high-priority follow-up.

#### P2-6: Repeated auth boilerplate across all write commands

- **Evidence:** Every authenticated command handler in `inventory.ts`, `roast.ts`, `sales.ts`, `tasting.ts` has the same 6-line pattern:
  ```typescript
  const supabase = await createAuthenticatedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthError('Not logged in. Run `purvey auth login` first.');
  ```
  This appears 15+ times across 4 files.
- **Impact:** Violates DRY. If the auth check logic or error message changes, it must be updated in 15+ places. The `createAuthenticatedClient()` already throws on no credentials; the `getUser()` check is a belt-and-suspenders validation that could be extracted.
- **Correction:** Create a helper like `getAuthenticatedUserAndClient()` that returns `{ supabase, user }` and throws on failure. Single source of truth for the auth dance.

### P3 (nice to have)

#### P3-1: Error class names still use `PrvrsError` prefix

- **Evidence:** `src/lib/errors.ts` — `PrvrsError`, `AuthError extends PrvrsError`, `ConfigError extends PrvrsError`. Error code strings like `'AUTH_ERROR'`, `'CONFIG_ERROR'`, `'INVALID_ARGUMENT'` are fine.
- **Impact:** Internal naming inconsistency. Users may see `PrvrsError` in stack traces if `PRVRS_DEBUG` is enabled, which doesn't match the `purvey` branding.
- **Correction:** Rename to `PurveyError` or `PurveyCLIError`. This is a breaking change for anyone catching errors by class name (unlikely for a young CLI).

#### P3-2: README documents `purvey coffee list --csv` but no `coffee` command exists

- **Evidence:** `README.md:105` — `purvey coffee list --csv > coffees.csv`. The actual command is `purvey catalog search`.
- **Impact:** Copy/paste from README will fail. Users will be confused.
- **Correction:** Change to `purvey catalog search --csv > coffees.csv` or add a `coffee` alias for `catalog`.

#### P3-3: Roast batch name default uses em dash

- **Evidence:** `src/commands/roast.ts:234` — ``batchName = `${coffeeName} — ${roastDate}`;``
- **Impact:** Per project style preferences, em dashes are explicitly discouraged. This is in data, not prose, but still a style inconsistency.
- **Correction:** Replace `—` with `-` or `|` or simply a space/comma.

#### P3-4: No `--json` flag (only compact JSON as default)

- **Evidence:** `src/types/index.ts:5` defines `GlobalOptions` with `json?: boolean` but it's never wired up. The default is already compact JSON, making `--json` redundant; however, it's in the type definition, suggesting it was planned.
- **Impact:** Inconsistency between type definitions and implementation. No functional impact since default is already JSON.
- **Correction:** Either remove `json` from `GlobalOptions` or wire it up as a no-op/explicit flag for clarity in scripting contexts.

#### P3-5: Confirmation prompt doesn't handle piped stdin gracefully

- **Evidence:** `src/lib/prompts.ts` — `confirm()` reads from stdin. If stdin is piped (non-TTY), readline may behave unpredictably.
- **Impact:** `echo "" | purvey inventory delete 7` might hang or auto-reject. The `--yes` flag mitigates this for scripts.
- **Correction:** Check `process.stdin.isTTY` and auto-reject (or auto-accept with a warning) when not in a TTY. Low priority since `--yes` exists.

---

## Assumptions Review

| Assumption                                            | Validity | Notes                                                                              |
| ----------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| All existing users will re-authenticate after upgrade | Weak     | No migration path; users will silently lose sessions                               |
| `PRVRS_DEBUG` is intentionally not renamed            | Weak     | More likely an oversight; inconsistent with rest of rename                         |
| RLS policies enforce all data access boundaries       | Valid    | All write commands verify `user.id` ownership; RLS is belt-and-suspenders          |
| The Supabase anon key in source is safe to expose     | Valid    | Standard Supabase pattern; anon key + RLS is the intended auth model               |
| npm publish workflow works                            | Invalid  | Missing `NODE_AUTH_TOKEN`; will fail on any tag push                               |
| `database.types.ts` will be populated eventually      | Valid    | Typegen workflow exists; needs `SUPABASE_ACCESS_TOKEN` secret and a manual trigger |

---

## Tech Debt Notes

- **Debt introduced:** None by this PR (pure rename).
- **Debt carried forward:**
  - Repeated auth boilerplate (15+ instances of the same 6-line pattern)
  - Empty `database.types.ts` providing no compile-time safety
  - OAuth callback server lacks timeout and CSRF protection
  - `sanitizeFilterValue` doesn't cover `%` or `_` wildcards
- **Suggested follow-up tickets:**
  1. Extract `getAuthenticatedUserAndClient()` helper (DRY fix)
  2. Run typegen and wire up `SupabaseClient<Database>` typing
  3. Add OAuth state parameter and callback timeout
  4. Rename `PRVRS_DEBUG` -> `PURVEY_DEBUG` (or `PURVEYORS_DEBUG`)
  5. Add credential migration from old config path

---

## Product Alignment Notes

- **Alignment wins:**
  - `purvey` is a much better CLI name than `prvrs` (pronounceable, memorable, fits the brand)
  - Docs link now points to the actual GitHub repo instead of a non-existent `/docs/cli` page
  - Version bump to 0.2.0 correctly signals a breaking change
- **Misalignments:**
  - README example `purvey coffee list` doesn't match actual command `purvey catalog search`
  - `PRVRS_DEBUG` env var still branded with old name
  - Existing users get a confusing "not logged in" instead of a migration prompt

---

## Test Coverage Assessment

- **Existing tests that validate changes:** None of the tests are affected by the rename (tests exercise pure logic functions, not CLI name strings).
- **Missing tests:**
  - `sanitizeFilterValue()` has no unit tests (should test edge cases: `%`, `_`, empty string, unicode)
  - No integration/smoke tests for CLI invocation (`purvey --help`, `purvey --version`)
  - No tests for `readCredentials`/`writeCredentials`/`deleteCredentials` (file I/O mocking)
  - No tests for error formatting in `fatal()` / `withErrorHandling()`
  - No tests for `createAuthenticatedClient()` session refresh logic
  - No tests for CSV escaping edge cases (double quotes within values)
- **Suggested test additions (priority order):**
  1. `sanitizeFilterValue()` unit tests
  2. Smoke test: `node dist/index.js --help` exits 0 and contains "purvey"
  3. `config.ts` unit tests with temp directories
  4. Error handler tests

---

## Minimal Correction Plan

Before merge:

1. **Rename `PRVRS_DEBUG`** to `PURVEY_DEBUG` in `src/lib/errors.ts`, `README.md`, and `AGENTS.md` (P1-1)
2. **Add credential migration** or document the breaking change prominently in README (P1-2)
3. **Fix publish workflow** — add `NODE_AUTH_TOKEN` env var (P1-3)
4. **Update `.gitignore`** — change `~/.config/prvrs/` to `~/.config/purvey/` (P2-1)
5. **Fix README example** — `purvey coffee list` -> `purvey catalog search` (P3-2)

Items 1, 3, 4, 5 are one-line fixes. Item 2 is a judgment call: either add ~10 lines of migration code in `readCredentials()` or add a "Breaking Changes" section to the README.

---

## Optional Patch Guidance

### P1-1: Rename PRVRS_DEBUG

`src/lib/errors.ts`:

- Line 35: `process.env.PRVRS_DEBUG` -> `process.env.PURVEY_DEBUG`
- Line 40: `process.env.PRVRS_DEBUG` -> `process.env.PURVEY_DEBUG`

`README.md` line 127: `PRVRS_DEBUG` -> `PURVEY_DEBUG`

`AGENTS.md` line 69: `PRVRS_DEBUG` -> `PURVEY_DEBUG`

### P1-2: Credential migration (option A — code migration)

In `src/lib/config.ts`, add after `CREDENTIALS_FILE` constant:

```typescript
const LEGACY_CONFIG_DIR = join(homedir(), '.config', 'prvrs');
const LEGACY_CREDENTIALS_FILE = join(LEGACY_CONFIG_DIR, 'credentials.json');
```

In `readCredentials()`, after the initial `access()` fails:

```typescript
// Check legacy path for migration
try {
  await access(LEGACY_CREDENTIALS_FILE, constants.R_OK);
  const raw = await readFile(LEGACY_CREDENTIALS_FILE, 'utf-8');
  const creds = JSON.parse(raw) as StoredCredentials;
  // Migrate to new location
  await writeCredentials(creds);
  console.error(chalk.blue('ℹ Migrated credentials from ~/.config/prvrs/ to ~/.config/purvey/'));
  return creds;
} catch {
  return null;
}
```

### P1-3: Fix publish workflow

In `.github/workflows/publish.yml`, the Publish step:

```yaml
- name: Publish
  run: npx npm@latest publish --access public --provenance
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### P2-1: .gitignore fix

Line 7: `~/.config/prvrs/` -> `~/.config/purvey/`

### P3-2: README example fix

Line 105: `purvey coffee list --csv > coffees.csv` -> `purvey catalog search --csv > catalog.csv`
