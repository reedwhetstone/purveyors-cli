# PR Verification Report: AI-Assisted Bean Matching

## Metadata

- **CLI Repo:** `reedwhetstone/purveyors-cli` (PR #18)
- **Server Repo:** `reedwhetstone/coffee-app` (PR #108)
- **Base (CLI):** `f32672e` (main, post-PR #17)
- **Head (CLI):** `11f2f0e` (feat: AI-assisted bean matching for roast watch)
- **Base (Server):** `59e64c5` (main, post-PR #107)
- **Head (Server):** `0a56c80` (feat: add AI classify-roast proxy endpoint)
- **Reviewer model:** `anthropic/claude-opus-4-6`
- **Confidence:** High
- **Scope note:** Cross-repo audit covering CLI watch integration and server-side AI proxy endpoint

## Executive Verdict

- **Merge readiness:** Ready with fixes
- **Intent coverage:** Full
- **Priority summary:** P0: 1, P1: 3, P2: 4, P3: 3

## Intent Verification

### PR #18 (CLI)

- **Stated intent:** Add `--auto-match` flag to `purvey roast watch`. Parse .alog metadata, fetch inventory, call AI endpoint, auto-assign beans with 50% confidence threshold. Graceful fallback.
- **What was implemented:** `--auto-match` flag wired through both `--form` and CLI flag paths. New `src/lib/ai.ts` module with typed client. `runAutoMatch()` in watch.ts handles full pipeline. `needs-review` status for low-confidence/failed matches. Enhanced verification table with AI columns. 19 tests covering types, thresholds, error paths.
- **Coverage gaps:** None for stated intent.

### PR #108 (Server)

- **Stated intent:** Add `POST /api/ai/classify-roast` proxy endpoint with auth + member role validation. Proxy to OpenRouter. Return match with confidence score.
- **What was implemented:** SvelteKit `+server.ts` endpoint. `requireMemberRole()` guard. Input validation. OpenRouter via `@ai-sdk/openai` with `@preset/cli-agent` model alias. JSON parse with markdown fence fallback. Error propagation for 429/auth errors.
- **Coverage gaps:** None for stated intent.

## Findings by Severity

### P0 (must fix before merge)

#### 1. Module-level mutable state (`_lastAiMatch`) is a concurrency hazard

- **Evidence:** `src/lib/interactive/watch.ts` lines 533-534: `let _lastAiMatch: ImportRecord['aiMatch'] | undefined;` — a module-level mutable variable carries the AI match result from `runAutoMatch()` to the success record builder.
- **Impact:** If two .alog files arrive within the debounce window and both pass the `processing` set guard (unlikely but possible if debounce fires near-simultaneously), the second `runAutoMatch` call would overwrite `_lastAiMatch` before the first `processFile` reads it, attributing the wrong AI match to the wrong roast record. Even more concerning: the `finally` block sets `_lastAiMatch = undefined`, which could race against a concurrent read.
- **Correction:** Return the `aiMatch` data from `runAutoMatch()` and thread it through `processFile()` as a local variable instead of module-level state. The `aiResult` local already has `.aiMatch` — just use it directly:

```typescript
// In the success branch, replace _lastAiMatch with:
const aiMatchField = opts.autoMatch && !opts.promptEach ? aiResult?.aiMatch : undefined;
```

This eliminates the shared mutable state entirely. The `aiResult` is already captured in the function scope from the auto-match branch above.

### P1 (should fix before merge)

#### 2. Server endpoint uses `event.locals.safeGetSession()` which reads cookies, not Bearer tokens

- **Evidence:** `src/routes/api/ai/classify-roast/+server.ts` line 38 calls `requireMemberRole(event)`, which calls `requireUserAuth(event)`, which calls `event.locals.safeGetSession()`. The `safeGetSession()` (defined in `hooks.server.ts` lines 46-72) calls `supabase.auth.getSession()` which reads from the Supabase SSR cookie, not from the `Authorization: Bearer` header.
- **Impact:** The CLI sends `Authorization: Bearer ${session.access_token}` (in `src/lib/ai.ts` line 62). However, SvelteKit's Supabase SSR client (`@supabase/ssr`) creates a server client per request in the hooks middleware that reads from cookies. The Bearer header sent by the CLI won't be automatically picked up by the cookie-based auth flow. The CLI call will likely fail with 401 because there's no cookie session for a programmatic HTTP request.
- **Evidence (hooks):** `hooks.server.ts` line 31-42 creates the Supabase server client using `cookies: { getAll, setAll }` — pure cookie-based. No header extraction.
- **Correction:** The endpoint should use `requireAuth(event)` (which reads the `Authorization` header directly) instead of `requireMemberRole(event)` for the auth check, then separately check the role. Or create a `requireMemberRoleBearer(event)` that combines header-based auth with role validation:

```typescript
const user = await requireAuth(event);
const role = await getUserRole(supabase, user.id);
if (!checkRole(role, 'member')) {
  return json({ error: 'Member role required' }, { status: 403 });
}
```

This is **critical for the CLI to work at all** — promoting to P0 consideration, but leaving at P1 because the fix is straightforward and may already be handled by Supabase SSR's header detection in some configurations.

#### 3. No server-side validation of AI response structure

- **Evidence:** `src/routes/api/ai/classify-roast/+server.ts` lines 119-137. The parsed JSON is cast directly as `MatchResult` without validating field types or ranges: `match = parsed as MatchResult`.
- **Impact:** If the LLM returns `{ "inventoryId": "seven", "confidence": "high" }` or any malformed structure, the endpoint passes it through to the CLI unchecked. The CLI has defensive coding (`confidence < 50` check) but assumes `confidence` is a number. String-typed confidence would pass the `< 50` check (string comparison) and could auto-import with bogus data.
- **Correction:** Add runtime validation before returning:

```typescript
if (match !== null) {
  if (
    typeof match.inventoryId !== 'number' ||
    typeof match.confidence !== 'number' ||
    typeof match.coffeeName !== 'string' ||
    typeof match.reasoning !== 'string'
  ) {
    console.warn('classify-roast: AI returned invalid shape:', match);
    return json({ match: null, warning: 'AI response had invalid field types' });
  }
  match.confidence = Math.round(Math.max(0, Math.min(100, match.confidence)));
}
```

#### 4. Hardcoded `baseUrl` in CLI AI client

- **Evidence:** `src/lib/ai.ts` line 55: `const baseUrl = 'https://purveyors.io';`
- **Impact:** No way to test against a local dev server or staging environment. Other parts of the CLI likely use a configurable base URL (from `purvey config`). This creates an inconsistency and makes local development of the AI feature impossible without modifying source.
- **Correction:** Read the base URL from the existing CLI config or accept it as a parameter:

```typescript
const baseUrl = process.env.PURVEYORS_API_URL ?? 'https://purveyors.io';
```

Or better, pass it from the existing Supabase config that already knows the project URL.

### P2 (important improvements)

#### 5. Server system prompt asks AI to return `null` below 30% but CLI threshold is 50%

- **Evidence:** Server `+server.ts` line 108: `"If no bean is a reasonable match (confidence below 30), respond with null."` vs CLI `watch.ts` line 648: `if (confidence < 50)`.
- **Impact:** There's a gap between 30-49% where the AI will still return a match object (not null) but the CLI will mark it as `needs-review`. This is functionally fine — the dual threshold provides defense-in-depth. But the discrepancy is worth documenting. The AI might waste tokens reasoning about a 35% match that the CLI will discard anyway.
- **Correction:** Consider aligning the prompt threshold with the CLI threshold, or document the intentional gap. Changing the prompt to 50% would reduce unnecessary AI reasoning tokens.

#### 6. No rate limiting on the server endpoint

- **Evidence:** `src/routes/api/ai/classify-roast/+server.ts` has no rate limiting middleware. Each call proxies to OpenRouter which costs real money.
- **Impact:** A malicious or runaway CLI could hammer the endpoint. Auth gates it to members, but a compromised member token could still cause cost runaway. The watch debounce (2 seconds) provides some natural throttling, but nothing server-side.
- **Correction:** Add a simple per-user rate limit (e.g., 10 requests/minute). Can be done in-memory for now, or via a Supabase RPC counter.

#### 7. Inventory limited to 100 items without pagination

- **Evidence:** `watch.ts` line 601: `.limit(100)` on the inventory query.
- **Impact:** Users with >100 stocked inventory items would get incomplete data sent to the AI, potentially causing wrong matches. 100 is likely sufficient for most roasters, but worth documenting as a known limitation.
- **Correction:** Log a warning when the inventory count hits 100, suggesting the user narrow their stocked items.

#### 8. `@preset/cli-agent` model alias is opaque

- **Evidence:** `+server.ts` line 99: `openrouter.chat('@preset/cli-agent')`.
- **Impact:** This OpenRouter preset alias could change model routing at any time without code changes. There's no way to know which model is actually serving requests, making debugging and cost estimation unpredictable.
- **Correction:** Consider using an explicit model ID (e.g., `anthropic/claude-sonnet-4-6`) or at minimum log which model was used in the response. The `result.usage` or `result.response.headers` from OpenRouter could provide this.

### P3 (nice to have)

#### 9. Tests use `vi.fn()` global fetch mocking without cleanup guarantee

- **Evidence:** `tests/ai.test.ts` — multiple tests replace `global.fetch` in try/finally blocks. While the finally pattern is correct, there's no `afterEach` safety net.
- **Impact:** If a test throws before entering the try block (unlikely but possible), `global.fetch` stays mocked. Low risk in practice.
- **Correction:** Add `afterEach(() => { global.fetch = originalFetch; })` in the describe block for belt-and-suspenders safety.

#### 10. Tests redefine `ImportRecord` type locally instead of importing

- **Evidence:** `tests/ai.test.ts` — the `ImportRecord aiMatch field` describe block (lines 257+) defines its own `ImportRecord` type inline instead of importing from `watch.ts`.
- **Impact:** If the real `ImportRecord` type drifts from the test's local copy, the type-level checks become meaningless.
- **Correction:** Import `ImportRecord` from `../src/lib/interactive/watch.js` directly.

#### 11. Verification table auto-match column widths are tight

- **Evidence:** `watch.ts` line 179: `COL_BEAN = 22`. Many specialty coffee names exceed 22 characters (e.g., "Ethiopia Yirgacheffe Natural Process").
- **Impact:** Names get truncated with `…`. Functional but suboptimal UX for the verification summary.
- **Correction:** Consider bumping to 28-30 chars or auto-sizing based on content.

## Assumptions Review

| #   | Assumption                                                     | Validity            | Why                                                                                                                                                                                | Action                                                    |
| --- | -------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Supabase SSR auth will pick up Bearer tokens from CLI requests | **Weak**            | `@supabase/ssr` creates a cookie-based client in hooks. Bearer tokens from programmatic HTTP clients may not be recognized by `getSession()`                                       | **P1 #2**: Verify or switch to `requireAuth()`            |
| 2   | AI will return valid JSON without markdown fencing             | **Weak**            | LLMs frequently wrap JSON in ```json fences despite instructions. The server has fallback stripping, but no structural validation                                                  | Code handles fence stripping; add type validation (P1 #3) |
| 3   | 50% confidence threshold is appropriate                        | **Valid**           | It's a reasonable starting point. Below 50% is coin-flip territory. The dual-threshold with server at 30% provides safety margin                                                   | Document the intentional gap (P2 #5)                      |
| 4   | `processFile` is never truly concurrent                        | **Weak**            | The `processing` Set prevents double-processing of the _same_ file, but different files can process concurrently. The module-level `_lastAiMatch` can race between different files | **P0 #1**: Eliminate shared mutable state                 |
| 5   | Users have <100 stocked inventory items                        | **Valid (for now)** | Most specialty coffee roasters keep 10-30 greens in stock. 100 is generous                                                                                                         | Document limitation (P2 #7)                               |
| 6   | `@preset/cli-agent` resolves to a capable model                | **Valid**           | OpenRouter presets are stable, but the resolved model is invisible                                                                                                                 | Log the model used (P2 #8)                                |

## Tech Debt Notes

- **Debt introduced:**
  - Module-level mutable state pattern (`_lastAiMatch`) — anti-pattern for async code. Should be scoped to function.
  - Hardcoded production URL in `ai.ts` — prevents local development.
  - `as MatchResult` type assertion without validation — type-unsafe at runtime boundary.
- **Debt worsened:** None significant.
- **Suggested follow-up tickets:**
  - Add end-to-end test for the full auto-match pipeline (mock server, verify session persistence)
  - Add server-side rate limiting for AI endpoints
  - Make AI proxy base URL configurable
  - Consider structured output (Zod schema) with `generateObject` instead of `generateText` + manual JSON parse

## Product Alignment Notes

- **Alignment wins:**
  - Auto-match is opt-in (`--auto-match` flag), preserving existing workflow
  - Graceful degradation: failures become `needs-review`, never crash the watch session
  - Clear UX: AI reasoning shown inline, verification table shows confidence percentages
  - Post-session guidance for unmatched files with manual import command
- **Misalignments:** None.
- **Suggested product checks:**
  - Verify the 50% threshold feels right with real roast data (may want to tune after initial usage)
  - Consider a `--confidence <n>` flag to let users set their own threshold

## Test Coverage Assessment

- **Existing tests that validate changes:** 19 tests in `tests/ai.test.ts` covering:
  - Type shape validation (minimal input, full metadata, optional fields)
  - Response parsing (valid match, null match, malformed response)
  - Confidence threshold logic (boundary at 50%, above, below)
  - `classifyRoast` error handling (no session, 403, 429, 500, network error, success)
  - ImportRecord AI fields (success record, needs-review, optional field)
- **Missing tests:**
  - **`runAutoMatch()` integration**: No tests for the full `runAutoMatch` pipeline (metadata parsing, inventory fetch, AI call, inventory ID verification). This is the critical path.
  - **Server endpoint**: No tests for `+server.ts` — input validation, auth rejection, malformed AI response passthrough, markdown fence stripping.
  - **Session persistence with AI data**: No test verifying that `saveWatchSession`/`loadWatchSession` correctly round-trips the `aiMatch` field and `needs-review` status.
  - **Empty inventory path in `runAutoMatch`**: Tested implicitly (returns `skip: true`) but no explicit test.
  - **Unknown inventory ID returned by AI**: No test for the `matchedItem` check that verifies the AI didn't hallucinate an inventory ID.
- **Suggested test additions:**
  1. Mock-based `runAutoMatch` test covering: successful match, low confidence, null match, inventory fetch failure, AI error, unknown inventory ID
  2. Server endpoint test with supertest or similar: valid request, missing auth, invalid body, rate limit passthrough
  3. Session persistence round-trip test with `needs-review` records

## Minimal Correction Plan

1. **P0 #1:** Replace `_lastAiMatch` module-level state with a local variable threaded from `runAutoMatch()` result. The `aiResult` variable already holds `.aiMatch` in scope — use it directly.
2. **P1 #2:** Verify that the Supabase SSR client picks up Bearer tokens from API requests, or switch `classify-roast` endpoint to use `requireAuth(event)` + manual role check. This is critical for the CLI to actually work.
3. **P1 #3:** Add runtime type validation on the parsed AI JSON before returning it from the server endpoint.
4. **P1 #4:** Make `baseUrl` in `ai.ts` configurable via env variable or existing CLI config.

## Optional Patch Guidance

### P0 #1 — Eliminate `_lastAiMatch`

**File:** `src/lib/interactive/watch.ts`

- Delete the `let _lastAiMatch` declaration (line ~533)
- Delete `_lastAiMatch = aiMatch;` in `runAutoMatch()` (line ~659)
- Delete `_lastAiMatch = undefined;` in the `finally` block (line ~450)
- In `processFile()`, capture `aiResult` in a broader scope:

```typescript
// Declare before the auto-match block
let aiResult: AutoMatchResult | undefined;

// In the auto-match block, assign:
aiResult = await runAutoMatch(supabase, userId, filename, fileContent);

// In the success record builder, replace _lastAiMatch:
const aiMatchField = aiResult?.aiMatch;
```

### P1 #2 — Fix auth for Bearer token

**File:** `src/routes/api/ai/classify-roast/+server.ts`

Replace `await requireMemberRole(event);` with:

```typescript
import { requireAuth, getUserRole } from '$lib/server/auth';
import { checkRole } from '$lib/types/auth.types';

const user = await requireAuth(event);
const role = await getUserRole(supabase, user.id);
if (!checkRole(role, 'member')) {
  return json({ error: 'Member role required' }, { status: 403 });
}
```

### P1 #3 — Validate AI response shape

**File:** `src/routes/api/ai/classify-roast/+server.ts`

After `match = parsed as MatchResult;`, add:

```typescript
if (match !== null) {
  if (
    typeof match.inventoryId !== 'number' ||
    typeof match.confidence !== 'number' ||
    typeof match.coffeeName !== 'string' ||
    typeof match.reasoning !== 'string'
  ) {
    console.warn('classify-roast: invalid response shape:', match);
    match = null;
  } else {
    match.confidence = Math.round(Math.max(0, Math.min(100, match.confidence)));
  }
}
```
