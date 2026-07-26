# CLI Architecture Decision Index

This index is the canonical registry for current CLI architecture decisions. Use the
full identifier or file path when citing a decision.

## Current ADR series

- [ADR-001: Transient OAuth with API-key credential custody](./ADR-001-transient-oauth-api-key-custody.md), superseded by ADR-003
- [ADR-003: Parchment-owned device authorization](./ADR-003-parchment-device-authorization.md), accepted
- [ADR-004: CLI machine-interface positioning](./ADR-004-cli-machine-interface-positioning.md), accepted

## Historical decision series

The older `notes/decisions` records use the `H-*` namespace so they cannot be confused
with the current ADR series:

- [H-001: CLI Subpath Exports for Chat Agent Consumption](../notes/decisions/001-cli-subpath-exports-for-chat-agent.md), superseded by the Parchment API and `@purveyors/sdk` boundary
- [H-002: Google OAuth with Headless Fallback Instead of API Keys](../notes/decisions/002-google-oauth-headless-auth.md), superseded by ADR-003

Historical implementation plans and PR audits may cite the identifiers that were in
use when they were written. Those citations describe prior context and do not override
this registry or the shipped source.
