# Notes Lifecycle

Files under `notes/implementation-plans/` and `notes/pr-audits/` are historical
execution records. Their future-tense language, status snapshots, architecture
claims, and findings describe the point in time when they were written. They are not
an active backlog or current architecture authority.

Use these maintained sources for current direction:

1. `README.md` for the shipped user and package contract
2. `AGENTS.md` for contributor guidance and source-of-truth rules
3. `docs/CLI_STRATEGY.md` for the current architecture retrospective
4. `docs/ADR-INDEX.md` for current and superseded decisions
5. `src/program.ts`, `src/commands/*`, `src/lib/manifest.ts`, and `package.json` for
   executable truth

The active cross-product backlog lives in coffee-app's canonical backlog. Do not add
a second active CLI task list here.
