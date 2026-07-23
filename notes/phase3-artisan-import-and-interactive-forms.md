# Phase 3: Artisan Import, Interactive Forms, and Data Integrity

_Last updated: 2026-07-22_
_Status: Historical plan; partially shipped and architecturally superseded_

> Current disposition: Artisan import and watch workflows shipped, but the shared
> architecture in this plan is no longer current. Coffee-app does not import CLI
> functions, roast classification now runs through Parchment and `@purveyors/sdk`,
> and the CLI stores a scoped Parchment API key rather than a Supabase session. Use
> `README.md`, `AGENTS.md`, `docs/CLI_STRATEGY.md`, and `docs/ADR-INDEX.md` for the
> maintained contract.

## Decisions (confirmed with Reed)

1. **One-step import.** CLI creates roast profile + imports .alog data in a single command. Batch name comes from `--batch-name` flag, `--form` mode, or auto-generated.
2. **`--form` is opt-in.** Flags are default (agent-first). Settings area to make form default for humans. `purvey config set form-mode true`.
3. **Watch mode with AI-assisted matching.** Auto-match uses Gemma 3 27B via OpenRouter (proxied through purveyors.io). Manual mode: user pre-selects beans in roast order. Both modes show verification table on session end before committing.
4. **CLI as library + binary.** `@purveyors/cli` exports importable functions via subpath exports. Coffee-app's chat agent imports functions directly (not subprocess). CLI commands are thin wrappers around the same functions.
5. **Single package.** Keep everything in `@purveyors/cli` until size justifies splitting `@purveyors/core`. One package, one version, one publish.
6. **AI proxy through purveyors.io.** CLI never holds API keys for AI. `POST /api/ai/classify-roast` validates auth + member role, proxies to OpenRouter server-side, tracks usage.
7. **All CLI behind auth.** No unauthenticated access. Catalog open access is website-only.
8. **Session persistence for watch.** `~/.config/purvey/watch-session.json` stores tentative matches. `purvey roast watch --resume` to recover from crashes.

---

## Architecture

```
@purveyors/cli (single npm package)
├── bin/purvey                    ← CLI binary (humans + scripts)
├── src/commands/*.ts             ← Commander definitions (CLI-only)
├── src/lib/                      ← Pure functions (importable by anyone)
│   ├── catalog.ts                → searchCatalog(), getCatalog(), getCatalogStats()
│   ├── inventory.ts              → listInventory(), addInventory(), etc.
│   ├── roast.ts                  → listRoasts(), createRoast(), deleteRoast()
│   ├── sales.ts                  → listSales(), recordSale(), etc.
│   ├── tasting.ts                → getTastingNotes(), rateCoffee()
│   ├── artisan/                  ← Extracted from coffee-app
│   │   ├── parser.ts             → parseAlogFile() (.alog Python literal syntax)
│   │   ├── validator.ts          → validateArtisanData()
│   │   ├── processor.ts          → processRoastData(), extractMilestones()
│   │   ├── temperature.ts        → normalizeTemperatures(), unitConversion()
│   │   └── types.ts              → ArtisanRoastData, ProcessedRoastData, etc.
│   └── import.ts                 → importArtisanFile() (orchestrator: parse→validate→process→write)
├── src/lib/interactive/          ← CLI-only (not exported)
│   ├── forms.ts                  → interactive form prompts (inquirer)
│   └── watch.ts                  → directory watcher (chokidar)
├── src/lib/config.ts             ← credential storage, settings
├── src/lib/supabase.ts           ← client setup
└── src/lib/output.ts             ← formatting (CLI-only)

package.json exports:
{
  ".": "./dist/index.js",
  "./catalog": "./dist/lib/catalog.js",
  "./inventory": "./dist/lib/inventory.js",
  "./roast": "./dist/lib/roast.js",
  "./sales": "./dist/lib/sales.js",
  "./tasting": "./dist/lib/tasting.js",
  "./artisan": "./dist/lib/artisan/index.js",
  "./import": "./dist/lib/import.js"
}

coffee-app consumes:
import { searchCatalog } from '@purveyors/cli/catalog';
import { importArtisanFile } from '@purveyors/cli/import';
```

### Chat Agent Integration (coffee-app tools.ts)

```typescript
// Before: 648 lines of Zod schemas + fetch() calls
coffee_catalog_search: tool({
  inputSchema: z.object({ origin: z.string(), ... }),
  execute: async (input) => callTool('/api/tools/coffee-catalog', input)
})

// After: direct function import from CLI package
import { searchCatalog, searchCatalogSchema } from '@purveyors/cli/catalog';

coffee_catalog_search: tool({
  inputSchema: searchCatalogSchema,
  execute: async (input) => searchCatalog(supabase, input)
})
```

### AI Proxy Flow

```
CLI (authenticated member)
  → POST purveyors.io/api/ai/classify-roast
    → Server validates session + member role
    → Server calls OpenRouter (server-side key in Vercel env)
    → Response + usage logging to api_usage
    → CLI receives classification result
```

---

## Database Foreign Key Chain (existing)

```
coffee_catalog (id)
    ↓ FK
green_coffee_inv (catalog_id → coffee_catalog.id, user → user_roles.id)
    ↓ FK
roast_profiles (coffee_id → green_coffee_inv.id, user → user_roles.id)
    ↓ FK (CASCADE DELETE)
roast_temperatures (roast_id → roast_profiles.roast_id)
roast_events (roast_id → roast_profiles.roast_id)

sales (green_coffee_inv_id → green_coffee_inv.id, user → user_roles.id)
```

The DB enforces integrity. The CLI adds helpful error messages on FK violations.

---

## Artisan Import Pipeline (existing in coffee-app)

Files to extract:
| coffee-app path | Lines | Dependencies |
|----------------|-------|-------------|
| `src/lib/types/artisan.ts` | ~250 | None |
| `src/lib/utils/alog-parser.ts` | 468 | None |
| `src/lib/utils/artisan-validator.ts` | 270 | artisan types |
| `src/lib/utils/temperature.ts` | 139 | None |
| `src/lib/data/artisan.ts` | 552 | All above + @supabase/supabase-js |

Total: ~1,680 lines. Zero SvelteKit dependencies. Clean extraction.

---

## PR Sequence

### PR 11: Restructure CLI for subpath exports

**Goal:** Make CLI functions importable by other packages.

- Refactor each command module to separate pure functions from Commander wrappers
- Current: `src/commands/catalog.ts` contains both the logic and the Commander definition
- After: `src/lib/catalog.ts` (pure functions + Zod schemas) + `src/commands/catalog.ts` (thin Commander wrapper)
- Add `exports` map to package.json
- Add Zod input/output schemas for each function (these become the chat agent's tool schemas)
- Ensure all lib functions accept a SupabaseClient as first arg (dependency injection, not import-time coupling)
- Tests: verify subpath imports work
- **No new features.** Pure refactor.

### PR 12: Extract artisan pipeline from coffee-app

**Goal:** Move artisan import code into the CLI package.

- Copy artisan types, parser, validator, temperature utils into CLI `src/lib/artisan/`
- Adapt imports (remove `$lib/` SvelteKit aliases, use relative paths)
- Create `src/lib/import.ts` orchestrator function
- Add comprehensive tests (port any existing tests from coffee-app)
- Verify the CLI builds and all existing tests pass
- **Does not yet add the CLI command.** Just the library code.

### PR 13: `purvey roast import` command

**Goal:** CLI command to import a single .alog file.

- `purvey roast import <file> --coffee-id <id> [--batch-name "name"]`
- `purvey roast import <file> --form` (interactive: pick bean, set name)
- One-step: creates roast_profile + imports temperature/event data
- Validates bean ownership (user must own the inventory item)
- Logs to artisan_import_log
- JSON output for agent consumption
- Human-readable summary with milestones, phases, weight loss

### PR 14: Interactive form mode (`--form`)

**Goal:** Step-by-step interactive prompts for all write commands.

- Add `@inquirer/prompts` dependency (need Reed's approval)
- `purvey roast create --form`
- `purvey inventory add --form`
- `purvey sales record --form`
- `purvey tasting rate --form`
- Forms fetch real data from Supabase (user's beans, roasts, etc.)
- `purvey config set form-mode true` to make forms default
- Config stored in `~/.config/purvey/config.json`

### PR 15: `purvey roast watch` command

**Goal:** Watch directory for new .alog files, import on save.

- `purvey roast watch <dir> [--auto-match | --manual]`
- Add `chokidar` dependency (need Reed's approval)
- Manual mode: user pre-selects beans in order, files matched sequentially
- Session state persisted to `~/.config/purvey/watch-session.json`
- `--resume` flag to recover from crashes
- Verification table on Ctrl+C (all tentative matches shown, user confirms)
- Batch submit after verification
- Document recommended Artisan file naming convention

### PR 16: AI-assisted watch matching

**Goal:** Auto-classify roasts against user's inventory using Gemma 3 27B.

- Add `POST /api/ai/classify-roast` endpoint to coffee-app
  - Validates auth + member role
  - Sends .alog metadata + user's stocked inventory to OpenRouter
  - Returns best match + confidence score
- CLI calls the proxy endpoint during auto-match mode
- Graceful fallback: if AI call fails, prompt user manually
- Usage tracking in api_usage table

### PR 17: Coffee-app chat agent migration

**Goal:** Replace tools.ts with CLI function imports.

- `npm install @purveyors/cli` in coffee-app
- Rewrite tools.ts to import from `@purveyors/cli/*`
- Use exported Zod schemas as tool input schemas
- Remove old `/api/tools/*` endpoints (or deprecate)
- Verify all chat agent functionality works
- This is the "flywheel" moment: CLI improvements auto-surface in chat

---

## Dependencies to Approve

Before implementation, Reed needs to approve these new dependencies:

1. **`@inquirer/prompts`** — interactive CLI prompts (PR 14)
2. **`chokidar`** — file system watcher (PR 15)
3. **`zod`** — schema validation, already used in coffee-app (PR 11)

---

## Open Items

- [ ] Verify `catalog_id` nullable on `green_coffee_inv` — if nullable, users can create inventory items without catalog link, breaking the integrity chain for CLI
- [ ] Document recommended Artisan file naming convention (e.g., "Bean Name - Batch Number.alog")
- [ ] Design config file schema (`~/.config/purvey/config.json`) for form-mode default, AI preferences
- [ ] Determine rate limits for AI classify-roast endpoint per tier
