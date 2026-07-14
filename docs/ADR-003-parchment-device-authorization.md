# ADR-003: Parchment-owned device authorization

**Status:** Accepted
**Date:** 2026-07-14

## Context

The CLI data plane already uses scoped Parchment API keys, but interactive login still knew how the web application's identity provider constructed authorization URLs, received browser callbacks, and represented temporary web sessions. That duplicated web-auth knowledge and required localhost listeners or pasted callback URLs in environments where agents and remote shells are primary users.

Coffee-app already owns Google PKCE login and the authenticated consent UI. Parchment now exposes a short-lived device authorization protocol that can bridge a CLI request to that existing browser session without exposing the resulting API key to the browser.

## Decision

`purvey auth login` uses Parchment's device authorization endpoints through `@purveyors/sdk`:

1. Generate a cryptographically random RFC 7636 verifier and S256 challenge.
2. Create a short-lived, machine-named authorization request through Parchment.
3. Open the returned purveyors.io verification URL, or print it directly for `--headless` and browser-open failures.
4. Poll at the server-provided interval until browser approval, expiry, cancellation, or a terminal protocol error.
5. Exchange the signed request token and verifier for a scoped, owner-bound Parchment API key.

Only the API key and non-sensitive identity/key metadata are persisted. The signed request token and PKCE verifier remain memory-only. The CLI does not construct provider authorization URLs, run a localhost callback server, parse browser callbacks, or handle access and refresh tokens.

## Consequences

Positive:

- Web and CLI login reuse the same coffee-app identity and consent surface while Parchment owns key issuance and validation.
- Headed and headless logins use one protocol; neither requires a pasted callback.
- The CLI knows only Parchment and purveyors.io contracts.
- Machine-key replacement is atomic and server-owned.

Negative:

- Login requires the coffee-app consent page and Parchment control plane to be available together.
- The CLI polls while waiting for approval, adding a small amount of short-lived request traffic.
- A user who lets the request expire must start a new login.

Risks and tradeoffs:

- The CLI must honor the server-provided polling interval and expiration.
- Request tokens and PKCE verifiers must never be logged or persisted.
- Browser launch is best-effort; printing the verification URL must always remain a usable fallback.
