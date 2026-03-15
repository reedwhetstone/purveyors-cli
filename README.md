# purvey — The Purveyors CLI

> Coffee intelligence from your terminal.

`purvey` is the official command-line interface for [purveyors.io](https://purveyors.io). It gives coffee professionals direct terminal access to the Purveyors platform: search green coffee availability, track pricing tiers, monitor inventory, and pipe data into spreadsheets, scripts, or dashboards.

---

## Installation

```bash
npm install -g @purveyors/cli
```

Requires **Node.js >= 20**.

Verify:

```bash
purvey --version
```

---

## Quick Start

```bash
# 1. Authenticate
purvey auth login

# 2. Confirm your session
purvey auth status

# 3. Explore commands
purvey --help
```

---

## Authentication

`purvey` authenticates via Google OAuth, using the same account as your purveyors.io web session.

### Login

```bash
purvey auth login
```

Opens your browser. Complete Google sign-in, then return to the terminal. Credentials are stored at `~/.config/purvey/credentials.json` (owner-readable only, mode 0600).

### Status

```bash
purvey auth status
```

```
✔ Logged in as you@example.com
ℹ Role: authenticated
ℹ Token expires: 2026-03-16T08:00:00.000Z
```

### Logout

```bash
purvey auth logout
```

Clears stored credentials from disk.

---

## Commands

### `purvey auth`

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `purvey auth login`  | Log in via Google OAuth (opens browser) |
| `purvey auth status` | Show current authentication state       |
| `purvey auth logout` | Clear stored credentials                |

---

## Output Formats

All `purvey` commands default to **compact JSON** — one line, no colors, machine-readable. This makes `purvey` pipeable into `jq`, `csvkit`, or any script.

### Default (compact JSON)

```bash
purvey auth status
# → {"authenticated":true,"email":"you@example.com","role":"authenticated","tokenExpires":"2026-03-16T08:00:00.000Z"}
```

### Pretty JSON (`--pretty`)

```bash
purvey auth status --pretty
# → indented, colorized JSON
```

### CSV (`--csv`)

```bash
purvey catalog search --csv > coffees.csv
```

### Piping with jq

```bash
purvey auth status | jq .email
# → "you@example.com"
```

User feedback messages (spinners, success/error) go to **stderr**, so they never pollute your stdout pipe.

---

## Environment Variables

| Variable                      | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `PURVEYORS_SUPABASE_URL`      | Override the Supabase project URL (useful for dev/staging) |
| `PURVEYORS_SUPABASE_ANON_KEY` | Override the Supabase anon key                             |
| `PURVEY_DEBUG`                | Set to any value to enable verbose error output            |

---

## Development

```bash
git clone https://github.com/reedwhetstone/purveyors-cli
cd purveyors-cli
pnpm install
```

Create a `.env` file:

```
PURVEYORS_SUPABASE_URL=https://your-project.supabase.co
PURVEYORS_SUPABASE_ANON_KEY=your-anon-key
```

Run locally:

```bash
pnpm dev -- auth status
pnpm dev -- --help
```

Build:

```bash
pnpm build
```

Lint + type check + test:

```bash
pnpm lint
pnpm check
pnpm test
```

See [AGENTS.md](./AGENTS.md) for the full contributor guide including architecture, code conventions, and PR requirements.

---

## License

Sustainable Use License. See [LICENSE.md](./LICENSE.md).

Copyright © 2026 Reed Whetstone / purveyors.io
