# AGENTS.md — Contributor Guide for @purveyors/cli

This is the single source of truth for anyone (human or AI agent) contributing to `purvey`. Read it before opening a PR.

---

## Project Overview

`purvey` is the official command-line interface for [purveyors.io](https://purveyors.io). It gives coffee professionals terminal access to the Purveyors platform: search the catalog, track inventory, monitor pricing, and pipe data into spreadsheets or scripts.

**Stack:** TypeScript (strict) + Commander.js + Supabase JS SDK + Vitest

---

## Setup

### Prerequisites

- Node.js >= 20
- pnpm (preferred package manager)

### Install dependencies

```bash
pnpm install
```

### Run locally

```bash
pnpm dev -- auth status
pnpm dev -- auth login
pnpm dev -- --help
```

The `--` separator passes arguments to the CLI rather than to pnpm/tsx.

### Build

```bash
pnpm build      # compiles TypeScript → dist/
pnpm check      # type-check only (no emit)
```

### Test

```bash
pnpm test           # vitest run (one-shot)
pnpm test:watch     # vitest watch mode
```

### Lint/format

```bash
pnpm lint       # prettier + eslint (check only)
pnpm format     # prettier write
```

All lint and type checks must pass before merging.

---

## Environment Variables

| Variable                      | Required | Description                                        |
| ----------------------------- | -------- | -------------------------------------------------- |
| `PURVEYORS_SUPABASE_URL`      | Yes      | Supabase project URL (get from Supabase dashboard) |
| `PURVEYORS_SUPABASE_ANON_KEY` | Yes      | Supabase anon/publishable key                      |
| `PRVRS_DEBUG`                 | No       | Set to any value to enable verbose error output    |

Create a `.env` file in the repo root for local development:

```
PURVEYORS_SUPABASE_URL=https://your-project.supabase.co
PURVEYORS_SUPABASE_ANON_KEY=your-anon-key
```

**Never commit the service role key.** The CLI authenticates as a user, not as the service.

---

## Architecture

### Directory structure

```
src/
  index.ts          # CLI entrypoint — registers all commands
  commands/
    auth.ts         # auth subcommands (login, status, logout)
  lib/
    config.ts       # ~/.config/purvey/ directory management
    supabase.ts     # Supabase client factory
    output.ts       # JSON/CSV/pretty output utilities
    errors.ts       # PrvrsError hierarchy + fatal() + withErrorHandling()
  types/
    index.ts        # Shared TypeScript types
tests/
  output.test.ts    # Unit tests for output utilities
```

### Adding a new top-level command

1. Create `src/commands/your-command.ts`
2. Export a `buildYourCommand(): Command` function
3. Import it in `src/index.ts` and call `program.addCommand(buildYourCommand())`
4. Add tests in `tests/your-command.test.ts`

### Commander.js conventions

- Every command file exports a single `build*Command(): Command` function
- Use `.action(withErrorHandling(async (...) => { ... }))` for all handlers — this catches errors and formats them consistently
- Accept `GlobalOptions` via `cmd.optsWithGlobals()` in action handlers
- Use `outputData(result, opts)` for data output; `success()`, `info()`, `warn()` for user messages

### Output format conventions

All commands must support:

- Default: compact JSON (`{"key":"value"}` — machine-readable, pipeable)
- `--pretty`: indented, colorized JSON for human reading
- `--csv`: CSV for spreadsheet import (only works with arrays/collections)

User feedback messages (login success, error messages, spinners) go to **stderr**. Data output goes to **stdout**. This ensures `purvey coffee list | jq` works correctly.

### Supabase client pattern

```typescript
// Unauthenticated (for login flow):
const client = createAnonClient();

// Authenticated (for all other commands):
const client = await createAuthenticatedClient();
// Throws AuthError if not logged in
```

### Error handling

Use `PrvrsError` subclasses for domain errors:

```typescript
throw new AuthError('Session expired. Run `purvey auth login`.');
```

Wrap all async action handlers with `withErrorHandling()`:

```typescript
const myAction = withErrorHandling(async (arg, cmd) => {
  // ...
});
```

---

## Credentials Storage

Stored at `~/.config/purvey/credentials.json` (mode 0600, owner-readable only). Contains: `accessToken`, `refreshToken`, `expiresAt` (ms), and basic user info. Never logged or transmitted anywhere beyond Supabase.

---

## CI

GitHub Actions runs on every push and on PRs to `main`:

1. Lint (prettier + eslint)
2. Type check (`tsc --noEmit`)
3. Tests (vitest)

All three must pass for PRs to merge.

---

## Code Style

- TypeScript strict mode, no `any` (use `unknown` + type narrowing)
- Single quotes, 2-space indent, 100-char line limit (configured in `.prettierrc`)
- Named exports preferred over default exports
- Async/await over Promise chains
- `os.homedir()` for home directory — never hardcode `~`

---

## Code Owners

Reed Whetstone (`@reedwhetstone`) owns all files. Tag him for review on any non-trivial change.
