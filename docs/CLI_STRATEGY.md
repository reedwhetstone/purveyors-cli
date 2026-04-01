# Purveyors CLI Strategy: From Tool Soup to a Single Coffee Intelligence Harness

_Created: 2026-03-14_
_Status: Strategy Draft_

## The Idea

Build a standalone CLI (`purveyors-cli` or `pvrs`) that becomes the single interface for all Purveyors data operations. The GenUI chat agent, the web app, external developers, and CI/CD all consume the same CLI. When we add a feature to the CLI, every surface gets it automatically.

**Inspiration:** Google Workspace CLI (`gws`) uses Google's Discovery Service to auto-generate its entire command surface at runtime. When Google adds an API endpoint, `gws` picks it up without code changes. We can apply the same principle: our CLI reads our own API schema and builds commands dynamically.

## What Google Workspace CLI Gets Right

### 1. Single AGENTS.md as Source of Truth

All agent instructions route through one file. Contributors, AI agents, and CI all follow the same rules. No scattered CLAUDE.md, COPILOT.md, .cursorrules, etc.

### 2. CLI-First Agent Architecture

Instead of defining tools in multiple places (Vercel AI SDK tool definitions in `tools.ts`, Zod schemas, endpoint handlers), they expose one CLI binary. The agent's "tools" are just CLI commands with structured JSON output. Adding a feature to the CLI automatically gives the agent a new capability.

### 3. Dynamic Command Surface from Discovery

`gws` doesn't hardcode commands. It fetches Google's Discovery JSON at runtime and builds a `clap` command tree dynamically. When a new API method appears, the CLI gets it for free. No code change, no deployment.

### 4. Auto-Generated Skills

Skills (SKILL.md files) are generated from the same Discovery metadata. Each API surface gets a skill file that teaches AI agents how to use it. The `generate-skills` command rebuilds all skill files when the API changes.

### 5. Rust for Speed, npm for Distribution

Built in Rust for instant startup and low overhead. Distributed via npm with pre-built native binaries. No Rust toolchain required for users.

## Current Purveyors Tool Architecture (Problems)

```
src/lib/services/tools.ts         — 648 lines of Zod schemas + tool definitions
src/routes/api/tools/             — 5 endpoint handlers (catalog, inventory, roasts, tasting, chunks)
src/routes/api/chat/+server.ts    — System prompt, model config, streamText orchestration
src/routes/api/catalog-api/       — Separate external API with its own auth
src/routes/api/                   — 15+ internal endpoints with duplicated query logic
```

**Problems:**

- Tool definitions are tightly coupled to the Vercel AI SDK
- Adding a new tool means editing `tools.ts` (Zod schema), creating an API endpoint, testing through the chat UI
- External API (`catalog-api`) duplicates logic from internal endpoints
- No way to test data operations outside the web app
- CI/CD can't exercise database operations without the full SvelteKit server running
- Agent instructions scattered across multiple files

## Proposed Architecture: `pvrs` CLI

### Command Structure

```
pvrs auth login                          # OAuth with Supabase
pvrs auth status                         # Show current session

pvrs catalog search --origin Ethiopia --process natural --limit 10
pvrs catalog get <id>
pvrs catalog stats                       # Aggregate stats (origins, avg price, etc.)

pvrs inventory list --stocked
pvrs inventory add --catalog-id 123 --qty 5 --cost-per-lb 7.50
pvrs inventory update <id> --notes "Great lot"

pvrs roast list --coffee-id 45 --limit 10
pvrs roast get <id> --include-temps --include-events
pvrs roast create --coffee-id 45 --batch-name "Ethiopia Guji #3"
pvrs roast import-artisan <file.alog> --roast-id 67

pvrs sales list --from 2026-01-01
pvrs sales record --roast-id 67 --oz 12 --price 18 --buyer "Local Cafe"
pvrs sales profit --period month

pvrs tasting get <bean-id> --filter both
pvrs tasting rate <bean-id> --aroma 8 --body 7 --acidity 6

pvrs workspace list
pvrs workspace summarize <id>
```

Every command outputs structured JSON by default. Add `--pretty` for human-readable output, `--csv` for spreadsheet export.

### How It Replaces Current Tools

| Current                           | CLI Equivalent                               |
| --------------------------------- | -------------------------------------------- |
| `tools.ts` coffee_catalog_search  | `pvrs catalog search`                        |
| `tools.ts` green_coffee_inventory | `pvrs inventory list`                        |
| `tools.ts` roast_profiles         | `pvrs roast list/get`                        |
| `tools.ts` bean_tasting_notes     | `pvrs tasting get`                           |
| `tools.ts` add_bean_to_inventory  | `pvrs inventory add`                         |
| `tools.ts` create_roast_session   | `pvrs roast create`                          |
| `tools.ts` record_sale            | `pvrs sales record`                          |
| `/api/catalog-api/` external API  | `pvrs catalog` (same commands, API key auth) |

### GenUI Integration

The chat agent's tool definitions become thin wrappers around CLI calls:

```typescript
// Before: 648 lines of Zod schemas and fetch() calls in tools.ts
coffee_catalog_search: tool({
  inputSchema: z.object({ origin: z.string(), ... }),
  execute: async (input) => {
    return callTool('/api/tools/coffee-catalog', input);
  }
})

// After: CLI as the tool backend
coffee_catalog_search: tool({
  inputSchema: z.object({ origin: z.string(), ... }),
  execute: async (input) => {
    return execCli('pvrs catalog search', input);
  }
})
```

Or even better: auto-generate tool definitions from CLI `--help` output, just like `gws` generates skill files from Discovery docs.

### The Flywheel You're Describing

1. **Build CLI command** → test it with the dev Supabase account
2. **CLI tests become integration tests** → `pvrs catalog search --origin Ethiopia` runs against the real DB
3. **Agent gets the capability automatically** → tool definition wraps the CLI call
4. **External API gets it too** → same CLI, different auth flag (`--api-key`)
5. **CI exercises everything** → CLI tests validate the full stack without a browser

This solves the CI/CD gap you've been feeling. Right now, testing data operations requires either the web app running or manual API calls. With the CLI, `cargo test` (or `node test`) can exercise the entire data layer in isolation.

## Language Choice: TypeScript vs Rust

### Option A: TypeScript (Node.js)

**Pros:**

- Shares types with the SvelteKit app (`database.types.ts`, `coffee.types.ts`)
- Supabase JS client works natively
- Faster iteration; same language as the web app
- Can import existing business logic from `src/lib/`
- Easier to contribute to (one language for the whole project)

**Cons:**

- ~500ms cold start (Node.js runtime)
- Larger binary/install footprint
- Less "impressive" for open-source perception

### Option B: Rust

**Pros:**

- Instant startup (<50ms)
- Single binary, no runtime dependency
- Google chose Rust for `gws` for this reason
- Strong open-source signal
- Can compile to WASM for browser use cases later

**Cons:**

- Supabase has no official Rust client (would use PostgREST HTTP API directly)
- Can't share types with the SvelteKit app
- Steeper learning curve; Reed doesn't write Rust currently
- Every schema change means updating Rust structs separately

### Recommendation: TypeScript First

Start with TypeScript. The type sharing with the SvelteKit app is too valuable to give up at this stage. You can always rewrite performance-critical paths in Rust later, or compile the TypeScript to a standalone binary using `pkg` or `bun compile`.

The real value of the CLI isn't speed; it's the unified interface pattern. A 500ms startup time doesn't matter when the Supabase round-trip is 200ms anyway.

## Implementation Phases

### Phase 0: Foundation (1-2 days)

- New repo: `reedwhetstone/purveyors-cli`
- TypeScript + Commander.js (or oclif for auto-generated help)
- Supabase client with env-based auth
- `pvrs auth login/status` commands
- JSON output by default, `--pretty` flag
- Basic CI: lint + type check

### Phase 1: Read Commands (2-3 days)

- `pvrs catalog search/get/stats`
- `pvrs inventory list`
- `pvrs roast list/get`
- `pvrs tasting get`
- Integration tests against dev Supabase
- Publish to npm as `@purveyors/cli`

### Phase 2: Write Commands (2-3 days)

- `pvrs inventory add/update`
- `pvrs roast create/import-artisan`
- `pvrs sales record`
- `pvrs tasting rate`
- Confirmation prompts for destructive operations

### Phase 3: GenUI Integration (2-3 days)

- Replace `tools.ts` with CLI-backed tool executors
- Auto-generate tool Zod schemas from CLI `--help` introspection
- Test: chat agent uses CLI commands instead of direct API calls
- Verify all existing GenUI functionality still works

### Phase 4: External API Convergence (1-2 days)

- `pvrs --api-key <key>` flag for external auth
- Deprecate `/api/catalog-api/` in favor of CLI commands
- SDK generation: `pvrs sdk generate --language typescript`

### Phase 5: Discovery-Based Expansion (ongoing)

- CLI reads an OpenAPI/schema file to build commands dynamically
- Adding a new Supabase table + schema entry auto-generates CLI commands
- `pvrs generate-skills` rebuilds agent skill files from the schema
- New features propagate to CLI → agent → web app automatically

## What This Means for the Product

**For developers:** `npm install -g @purveyors/cli` gives you the full coffee intelligence platform in your terminal. Build integrations, automate sourcing workflows, pipe data into spreadsheets.

**For the AI agent:** The chat bot becomes a thin UI layer over the CLI. Its capabilities grow automatically as the CLI expands. No more maintaining separate tool definitions.

**For B2B:** Enterprise customers get a CLI they can integrate into their own systems. Same commands, same output format, their own API key. Walled garden without custom development.

**For us (development):** One place to add features. CLI tests become integration tests. CI exercises the full stack. The "flywheel" where building the product tests the product.

## Decisions (Resolved Mar 14)

1. **Separate repo + shared types package.** Repo: `reedwhetstone/purveyors-cli`. Shared types via `@purveyors/types` (initially in coffee-app as `packages/types/`, published to npm). Coffee-app drives type expansion; CLI consumes.

2. **Auth model:** Two paths, one command surface.
   - Interactive: `purvey auth login` → browser OAuth (same Google OAuth as website) → encrypted local session token
   - Headless/CI/agent: API keys from purveyors.io dashboard, `purvey --api-key sk_...` or env var. Tied to user's account and access level.
   - Chat agent server-side: uses authenticated user's session token from SvelteKit context.

3. **Manual commands first, dynamic later.** Start with manually defined commands following strict conventions. After 15-20 commands, write the generator from patterns. Premature auto-generation would slow us down on edge cases we haven't discovered yet.

4. **Artisan parser moves to shared package.** Both web upload endpoint and `purvey roast import-artisan` call the same parser from `@purveyors/data`. Web app never calls the CLI binary; they're siblings sharing a parent library.

5. **Don't deprecate REST API; generate both surfaces from same schema.** CLI and API are two transports for the same data functions. `purvey catalog search --origin Ethiopia` and `GET /api/v1/catalog?origin=Ethiopia` resolve to the same function. One schema, two surfaces. Enterprise customers get both.

6. **CLI command name:** `purvey` (renamed from `prvrs` during PR #8, Mar 15)

7. **Language:** TypeScript. Type sharing with SvelteKit app is too valuable. Performance difference irrelevant when Supabase round-trips dominate.

8. **RLS battle-testing is a priority.** CLI is a new agentic surface; must validate all RLS policies hold under direct Supabase client access patterns.

## Next Steps

- [x] Reed reviews strategy and provides direction
- [x] Decisions on all open questions
- [x] Phase 0.0: coffee-app data layer refactor — complete, PRs #97-#105 merged Mar 14-15
- [x] Phase 0: CLI repo setup — complete, initial scaffold + CI/CD + npm publish (OIDC)
- [x] Phase 1: Read commands — complete (catalog, inventory, roast, tasting)
- [x] Phase 2: Write commands — complete (inventory, roast, sales, tasting + rename prvrs→purvey)
- [x] Phase 3: Artisan import, interactive forms, watch mode, AI matching — complete PRs #11-#18 Mar 15-16
- [x] Phase 4: coffee-app chat agent integration — complete, chat agent tools imported from CLI subpath exports (PRs #108-#109 coffee-app, Mar 17). Auth gating, headless auth, auto-refresh, TTY detection complete (CLI PRs #24-#36, v0.6.2). Published: v0.6.1 on npm (v0.6.2 tag+publish pending).
