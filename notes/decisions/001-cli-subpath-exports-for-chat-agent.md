# Historical Decision H-001: CLI Subpath Exports for Chat Agent Consumption

**Status:** Superseded by the Parchment API and `@purveyors/sdk` boundary
**Date:** 2026-03-14 (approximate)

> Historical record: coffee-app used this architecture during the initial GenUI
> build. It no longer imports `@purveyors/cli`. Today the CLI and coffee-app consume
> `@purveyors/sdk` independently, and the SDK consumes Parchment's OpenAPI contract.
> The exported CLI subpaths remain supported for agents and Node.js callers that
> intentionally want CLI behavior, but they are not the website's business-logic
> layer.

## Context

Purveyors.io's GenUI chat agent needs to call data operations (catalog search, inventory
CRUD, roast management, sales recording) as typed TypeScript functions from within
the SvelteKit server. Those same operations also need to stay easy for agents to
discover and call directly through the CLI itself. The naive approach is to keep
those functions inline in `tools.ts` alongside the Vercel AI SDK Zod schemas — but
that means every new feature requires changes in at least three places: the function
itself, the Zod schema, and the API endpoint handler.

The CLI was built simultaneously to expose the same operations to terminal users and
CI scripts. Rather than maintain two separate implementations, the goal was to make
the CLI package the single source of truth that both surfaces consume. This also
means the CLI is not a sidecar dev utility. It is a primary agent surface whose
exported functions feed the website directly.

## Decision

`@purveyors/cli` publishes subpath exports alongside the binary entry point:

```
"exports": {
  ".":            "./dist/index.js",   // CLI binary entry
  "./catalog":    "./dist/lib/catalog.js",
  "./inventory":  "./dist/lib/inventory.js",
  "./roast":      "./dist/lib/roast.js",
  "./sales":      "./dist/lib/sales.js",
  "./tasting":    "./dist/lib/tasting.js",
  "./lib":        "./dist/lib/index.js",
  "./artisan":    "./dist/lib/artisan/index.js",
  "./ai":         "./dist/lib/ai.js"
}
```

coffee-app imports these directly: `import { searchCatalog } from '@purveyors/cli/catalog'`.
The chat agent tools become thin wrappers around the CLI functions rather than
standalone implementations.

These exported functions are treated as an agent-first product contract. Naming,
arguments, validation, error semantics, and docs should optimize for reliable
machine use first, with human terminal affordances layered on top.

## Historical consequences

- New data operations added to the CLI are immediately available to the chat agent.
- A single set of types, validation logic, and error handling covers all surfaces.
- CLI ergonomics are website ergonomics, because coffee-app imports the same
  functions directly.
- coffee-app takes a runtime dependency on the CLI package (npm, not peer dep).
  Minor version bumps in the CLI must not break coffee-app's import surface.
- The CLI's release process must be followed before coffee-app can use new features:
  publish to npm, bump dep in coffee-app, update lockfile.
- Shared workflow changes should be dogfooded through the CLI or exported function
  directly, not only through the website wrapper.
- Revisit if the CLI and app diverge significantly in auth model or data shape.

## Current disposition

The revisit condition occurred. Parchment now owns shared data behavior and the
OpenAPI contract. `@purveyors/sdk` provides typed endpoint access. Coffee-app builds
session-aware web and chat adapters on that SDK, while the CLI adds terminal-specific
authentication, flags, file workflows, output envelopes, and exit codes on the same
SDK. The SDK does not use CLI functions.
