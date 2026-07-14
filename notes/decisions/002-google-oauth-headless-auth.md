# ADR-002: Google OAuth with Headless Fallback Instead of API Keys

**Status:** Superseded by `docs/ADR-003-parchment-device-authorization.md`
**Date:** 2026-03-14 (approximate)

## Context

The CLI needs to authenticate users against the same Supabase instance that powers
purveyors.io. Three options were considered:

1. **API keys** — User generates a long-lived token in the web UI, pastes it into
   the CLI. Simple but requires building a key management UI, exposes static secrets,
   and bypasses the existing auth infrastructure.
2. **Username/password** — Requires storing credentials locally or prompting on every
   run. Supabase's email/password auth works but is weaker than OAuth.
3. **Google OAuth** — Reuses the same provider the web app already uses. Short-lived
   JWT + refresh token stored in `~/.config/purvey/credentials.json`.

The primary target environment is an AI agent running in a headless container (no
browser, no interactive TTY). Standard OAuth flows require a browser redirect, which
doesn't work in that context. That headless agent path is not a niche fallback. It is
one of the main product environments for the CLI surface.

## Decision

Use Google OAuth via Supabase's `signInWithOAuth` for both modes:

- **Interactive mode** (`purvey auth login`): Opens a local HTTP server on a random
  port, launches the system browser, captures the OAuth callback automatically.
  Falls back gracefully if browser can't be opened.
- **Headless mode** (`purvey auth login --headless`): Generates the OAuth URL with
  `redirectTo: 'https://purveyors.io/auth/cli-callback'` and `skipBrowserRedirect: true`.
  Prints the URL; user visits it, authenticates, and pastes the resulting callback URL
  back into the CLI. The CLI extracts the session tokens from the URL fragment.

Headless mode is treated as a first-class supported path, not an afterthought. Auth
changes that preserve browser UX but break headless agent usability are regressions in
the primary machine-consumer surface.

Tokens are stored as access + refresh token pair. The Supabase client auto-rotates
the access token on expiry using the stored refresh token.

## Consequences

- No static API keys to leak or manage; tokens expire and rotate.
- Headless mode works in any environment (Docker, SSH, CI, agent containers).
- UX for headless is slightly awkward (copy-paste a URL), but it's a one-time setup.
- Future auth work should be judged partly on whether it reduces headless friction for
  agents, because they are primary CLI consumers.
- If Supabase or Google OAuth is unavailable, auth is completely broken — no offline
  fallback.
- Revisit if a machine-to-machine service account pattern is needed (e.g. for CI
  pipelines that can't do the copy-paste dance).
