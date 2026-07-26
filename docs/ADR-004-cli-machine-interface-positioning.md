# ADR-004: CLI machine-interface positioning

- Status: Accepted
- Date: 2026-07-25

## Context

The CLI is the machine and agent interface for Purveyors, while coffee-app is the
human interface. CLI-only client-side filters that diverge from the canonical API
contract are slop: they create a second query contract that agents cannot trust to
match the API.

## Decision

The CLI consumes canonical row-level catalog proof through `@purveyors/sdk` and
does not construct proof requests or proof projections locally. Retire
`--flavor`, `--supplier`, `--drying-method`, and `--sort=newest` from the CLI.

Future filters must first be built upstream as real API query parameters with an
agent-legible contract. Prefer bounded-output operations such as “top N newest”
over an unbounded “sort newest” option before exposing a new CLI surface.

## Consequences

Catalog contract alignment is cleaner and proof output has one typed source of
truth. The four filters are temporarily unavailable in the CLI, including the
shared supplier filters on catalog ranking commands; bounded-output variants can
be re-evaluated after upstream support exists.
