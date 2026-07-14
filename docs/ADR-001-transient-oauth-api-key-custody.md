# ADR-001: Transient OAuth with API-key credential custody

**Status:** Superseded by ADR-003
**Date:** 2026-07-12

## Context

The CLI historically stored Supabase access and refresh tokens and initialized the Supabase JavaScript client for every authenticated command. Once all user data operations moved behind the canonical Parchment API, retaining that runtime dependency and renewable browser-session credentials gave the CLI broader credential custody than it needed.

Parchment already supports session-authenticated API-key creation and owner-bound keys with exact read and write scopes. The CLI still needs Google OAuth to establish user identity, but it does not need to retain the resulting session.

## Decision

Google OAuth remains the interactive bootstrap. The CLI receives the callback session token, verifies it through Parchment, mints a replacement machine-named CLI key, then revokes superseded active keys with the same machine name. It stores only the new scoped Parchment API key plus non-secret identity metadata.

Runtime commands authenticate exclusively through the stored Parchment key or an explicit environment API-key override. Supabase access tokens, refresh tokens, the Supabase JavaScript client, and generated database types are not retained in the CLI runtime.

Each login mints the replacement before revoking active CLI keys with the same machine name. This preserves the existing credential if minting fails while limiting repeated logins from accumulating active machine credentials. API-key lifecycle remains server-owned.

## Consequences

Positive:

- Runtime credential custody is narrower and aligned with the API-first architecture.
- CLI access is constrained by explicit Parchment scopes and server-side ownership checks.
- The Supabase client and database schema types are removed from the published package.
- Revocation is visible and manageable through the existing Parchment key lifecycle.

Negative:

- A revoked key cannot refresh itself; the user must run `purvey auth login` again.
- Logout clears local custody but cannot revoke the server key because lifecycle endpoints require a session principal. Users can revoke it from the account key dashboard, and the next login replaces the machine-named key.
- The original browser callback bootstrap remained coupled to the web identity issuer. ADR-003 removes that final CLI-side coupling.

Risks and tradeoffs:

- Key creation must stay synchronized with the full set of CLI data-plane scopes.
- Revoking superseded keys is a multi-request operation. Mint failure preserves the prior local credential. A later partial revocation failure can leave an older key active and may already have revoked the locally stored prior key; the CLI best-effort revokes the newly minted key and does not commit the incomplete replacement.
