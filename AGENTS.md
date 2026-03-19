# AGENTS.md — Contributor Guide for @purveyors/cli

Single source of truth for anyone (human or AI agent) contributing to `purvey`. Read before opening a PR.

---

## Project Overview

`purvey` is the official CLI for [purveyors.io](https://purveyors.io). It gives users and AI agents terminal access to the Purveyors platform: catalog search, green coffee inventory, roast profiles, tasting notes, sales, and Artisan .alog import with AI-assisted bean matching.

**Stack:** TypeScript (strict) + Commander.js + Supabase JS SDK + Vitest  
**Current version:** 0.6.0  
**Binary:** `purvey`

---

## Setup

```bash
pnpm install
pnpm dev -- auth status    # run locally (-- passes args to the CLI)
pnpm dev -- catalog search --origin "Ethiopia" --pretty
pnpm build                 # compile TypeScript → dist/
pnpm check                 # type-check only
pnpm lint                  # prettier + eslint (check only)
pnpm format                # prettier write
pnpm test                  # vitest run
pnpm test:watch            # vitest watch mode
```

All lint, type check, and tests must pass before merging.

---

## Environment Variables

| Variable                      | Required | Description                                       |
| ----------------------------- | -------- | ------------------------------------------------- |
| `PURVEYORS_SUPABASE_URL`      | No       | Override Supabase URL (default: prod)             |
| `PURVEYORS_SUPABASE_ANON_KEY` | No       | Override anon key (default: prod)                 |
| `PURVEYORS_BASE_URL`          | No       | Override AI proxy URL (default: www.purveyors.io) |
| `PURVEY_DEBUG`                | No       | Enable verbose error output                       |

**Never commit secrets.** The CLI authenticates as a user (never service role).

---

## Architecture

```
src/
  index.ts                    # CLI entrypoint — registers all commands, grouped help
  commands/
    auth.ts                   # auth login (browser + --headless), status, logout
    catalog.ts                # catalog search, info, chunks — viewer role
    inventory.ts              # inventory list, add, update, delete, history — member
    roast.ts                  # roast list, create, import, update, delete, watch — member
    sales.ts                  # sales list, record, update, delete — member
    tasting.ts                # tasting list, rate — member
    config.ts                 # config get/set
    context.ts                # purvey context — agent onboarding reference
  lib/
    index.ts                  # Barrel export — re-exports all lib modules for subpath consumers
    auth-guard.ts             # requireAuth(role) — single auth/role enforcement point
    supabase.ts               # createAnonClient(), createAuthenticatedClient() w/ auto-refresh
    config.ts                 # ~/.config/purvey/ directory + credentials management
    output.ts                 # JSON/CSV/pretty output utilities
    errors.ts                 # PrvrsError hierarchy + fatal() + withErrorHandling()
    prompts.ts                # readline-based interactive prompt helpers
    ai.ts                     # classifyRoast() — AI bean matching via www.purveyors.io proxy
    catalog.ts                # searchCatalog(), getCatalogItem() — subpath export functions
    inventory.ts              # listInventory(), addInventory(), etc. — subpath export functions
    roast.ts                  # listRoasts(), createRoast(), etc. — subpath export functions
    sales.ts                  # listSales(), recordSale(), etc. — subpath export functions
    tasting.ts                # listTasting(), rateTasting() — subpath export functions
    artisan/
      db.ts                   # Database interaction utilities for Artisan data
      import.ts               # importRoastFromFile() — full import pipeline
      index.ts                # Artisan module barrel export
      parser.ts               # .alog XML parser
      temperature.ts          # Temperature conversion utilities
      types.ts                # TypeScript types for Artisan data
      validator.ts            # Data validation for Artisan imports
    interactive/
      watch.ts                # runWatch() — fs.watch + debounce + auto-match
      forms.ts                # clack prompt helpers shared across form modes
  types/
    database.types.ts         # Supabase-generated database types
    index.ts                  # Shared TypeScript types (StoredCredentials, etc.)
tests/
  *.test.ts                   # 11 test files — unit tests for output, artisan parse, AI, etc.
```

---

## Authentication

### Three auth modes

```bash
purvey auth login              # Browser Google OAuth (interactive)
purvey auth login --headless   # Prints OAuth URL, user pastes callback URL back (agents/servers)
purvey auth status             # Shows email, app role from user_roles table, token expiry
purvey auth logout             # Clears credentials
```

### Auto-refresh

`createAuthenticatedClient()` calls `supabase.auth.setSession()` which automatically uses the refresh token when the access token is expired. New tokens are persisted to `~/.config/purvey/credentials.json`. Login once, use forever.

### Role hierarchy

```
viewer   (0) — any logged-in user
member   (1) — member, api-member
admin    (2) — admin, api-enterprise
```

Use `requireAuth(role)` from `src/lib/auth-guard.ts` in all command handlers:

```typescript
// Any logged-in user (catalog reads):
const { supabase, userId } = await requireAuth('viewer');

// Member+ required (inventory, roast, sales, tasting, watch):
const { supabase, userId } = await requireAuth('member');
```

**Never call `createAuthenticatedClient()` directly in command handlers.** Always use `requireAuth()`.

Auth commands (`login`, `status`, `logout`), config, `--help`, and `--version` are unguarded.

---

## Adding a New Command

1. Create `src/commands/your-command.ts`
2. Export `buildYourCommand(): Command`
3. Register in `src/index.ts`: `program.addCommand(buildYourCommand())`
4. Add tests in `tests/your-command.test.ts`
5. Add to `purvey context` output in `src/commands/context.ts`

### Commander.js conventions

- Every handler: `.action(withErrorHandling(async (...) => { ... }))`
- Use `requireAuth('viewer' | 'member')` at the top of every handler
- Accept global options via `cmd.optsWithGlobals()` as `OutputOptions`
- Use `outputData(result, opts)` for data; `success()`, `info()`, `warn()` for messages
- Spinners via `p.spinner()` (clack) during Supabase writes

### Output conventions

All data commands must support:

- Default: compact JSON to **stdout** (machine-readable, pipeable)
- `--pretty`: indented, colorized JSON for humans
- `--csv`: CSV for spreadsheet import

User messages (spinners, confirmations, errors) → **stderr**. Data → **stdout**.
This ensures `purvey inventory list | jq '.[0].id'` works correctly.

### Help text conventions

Every subcommand gets `.addHelpText('after', ...)` with real-world examples:

```typescript
.addHelpText('after', `
Examples:
  purvey catalog search --origin "Ethiopia" --process "natural" --pretty
  purvey catalog search --stocked --limit 20 --json
`)
```

---

## Subpath Exports

The CLI exports functions for use by coffee-app's chat agent:

```json
"exports": {
  ".": "./dist/index.js",
  "./catalog": "./dist/lib/catalog.js",
  "./inventory": "./dist/lib/inventory.js",
  "./roast": "./dist/lib/roast.js",
  "./sales": "./dist/lib/sales.js",
  "./tasting": "./dist/lib/tasting.js",
  "./lib": "./dist/lib/index.js",
  "./artisan": "./dist/lib/artisan/index.js",
  "./ai": "./dist/lib/ai.js"
}
```

**The flywheel:** `coffee-app`'s `src/lib/services/tools.ts` imports these functions directly. CLI improvements automatically improve the chat agent.

---

## AI Bean Matching

`purvey roast watch --auto-match` uses `classifyRoast()` from `src/lib/ai.ts`:

1. Fetches user's stocked inventory (Supabase)
2. Parses .alog metadata (title, bean name, roaster, notes)
3. POSTs to `https://www.purveyors.io/api/ai/classify-roast` with Bearer token
4. Server checks auth via `requireAuth()` (Bearer header) + admin client role check
5. Proxies to OpenRouter's `@preset/cli-agent` model
6. Returns `{ inventoryId, coffeeName, confidence (0-100), reasoning }`
7. ≥50% confidence → auto-imports; <50% → marks `needs-review`

**Critical:** Always use `www.purveyors.io` — `purveyors.io` 308-redirects and Node fetch drops POST bodies on redirect.

---

## Release Process

1. Merge feature/fix PRs
2. Open bump PR: update `package.json` version (patch for fixes, minor for features)
3. Merge bump PR
4. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. GitHub Actions publishes to npm automatically via OIDC
6. Coffee-app uses `"@purveyors/cli": "^0.X.0"` — only update for minor/major bumps

---

## Credentials Storage

`~/.config/purvey/credentials.json` (mode 0600). Contains: `accessToken`, `refreshToken`, `expiresAt` (ms), user info. Never logged or transmitted beyond Supabase.

---

## CI

GitHub Actions on every push and PR to `main`:

1. Lint (prettier + eslint)
2. Type check (`tsc --noEmit`)
3. Tests (vitest — 11 test files)

All must pass. CI also publishes to npm on semver tags (`v*.*.*`).

---

## Code Style

- TypeScript strict mode, no `any` (use `unknown` + type narrowing)
- Single quotes, 2-space indent, 100-char line limit
- Named exports over default exports
- Async/await over Promise chains
- `os.homedir()` for home directory — never hardcode `~`

---

## Code Owners

Reed Whetstone (`@reedwhetstone`) owns all files.
