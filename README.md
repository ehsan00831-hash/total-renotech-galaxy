# TotalRÊNOTECH Operations Control Center

A Next.js operations application over the live TotalRÊNOTECH workbook. Google
Sheets stays the source of truth; this app is a fast, mobile-friendly interface
on top of it, plus a single write path shared by staff, ChatGPT and Claude.

---

## What is built

| Area | State |
|---|---|
| Next.js 16 + TypeScript + Tailwind 4, App Router | Working, production build clean |
| Sheets data layer (read + write, column resolution by header) | Working, needs a service account |
| Dashboard: 23 KPI cards, 3 charts, today plan, alerts | Working |
| Jobs: 11 saved views, filters, detail drawer, quick edit | Working |
| Completed: today / week / month / archive with totals | Working |
| Reminders: ACTIVE + ARCHIVE with automatic routing | Working |
| Materials derived from jobs | Working |
| Daily Logs with person-hour maths and project roll-up | Working |
| Team & Fleet roster feeding every crew/truck selector | Working |
| AI Inbox: preview → confirm → write | Working, needs an Anthropic key |
| `/api/ai/intake` universal endpoint | Working |
| ChatGPT Action OpenAPI spec at `/api/openapi` | Working |
| Claude MCP server (`mcp/server.mjs`), 12 tools | Working |
| Audit log with field-level undo | Working |
| Google OAuth + 4-role allowlist | Working, needs OAuth credentials |
| PWA manifest, installable | Working |
| English / Persian with full RTL | Working |
| Automated tests (108, `node:test`) | Working |
| OpenAPI spec emitted to `openapi.json` | Working |
| Deployed public URL | **Not done — needs a Vercel account** |

---

## Design rules that matter

**Columns are never hard-coded.** Every read resolves field names against the
live header row (`src/lib/schema.ts` declares the patterns). Reordering a column
in the sheet cannot corrupt a different field.

**View sheets are read-only.** Upcoming, Tomorrow Plan, Ongoing, Done, Materials
and Long Projects are formula views of All Jobs. `assertWritable()` refuses any
write to them. Change the job on All Jobs and the views follow.

**Writes patch single cells**, never whole rows, so a concurrent edit elsewhere
in the row survives.

**Duplicates are matched before writing** — Job ID, then WO, then PO, then
customer plus address. A repeated ChatGPT or Claude call updates rather than
duplicating. Idempotency keys block exact replays.

**Nothing is invented.** The AI prompt forbids guessing; unknown fields come
back null and stay blank in the sheet.

---

## Commands

The application, this README, `.env.example`, the MCP server and the OpenAPI
server URL all use **port 3000**. `package.json` pins it so a stray port cannot
creep back in.

| Command | Does |
|---|---|
| `npm ci` | Clean, lock-file-exact install |
| `npm test` | Compiles `src/lib/core.ts`, then runs 108 tests |
| `npm run build` | Production build |
| `npm run dev` | Dev server on `http://localhost:3000` |
| `npm start` | Production server on `http://localhost:3000` |
| `npm run openapi` | Writes `openapi.json` (pass a base URL to override) |
| `npm run mcp` | Starts the Claude MCP server |

### Tests

`src/lib/core.ts` holds every operations rule and performs no I/O, so the suite
exercises the real production module rather than a copy. Coverage:

- column resolution against a reordered sheet
- Full Address compose / parse round-trip
- job duplicate matching by ID, WO, PO, and customer + address
- every saved view, including unassigned and overdue
- completed today / week / month, and automatic previous-month archive
- material routing
- protected formula views
- multi-person crew assignment and the five-column spread
- daily person-hour calculations, including overnight shifts
- reminder vocabulary, merging, archive routing, `Completed — Check Required`
- idempotency keys and retry safety for jobs, reminders and daily logs
- audit trail entries

---

## Setup

### 1. Google service account (required for any real data)

1. [console.cloud.google.com](https://console.cloud.google.com) → create/pick a project.
2. APIs & Services → Library → enable **Google Sheets API**.
3. IAM & Admin → Service Accounts → create one → Keys → **Add key → JSON**.
4. Copy `client_email` and `private_key` from that JSON into `.env.local`.
5. **Open the spreadsheet → Share → paste the service account email → Editor.**
   Skipping this step is the usual cause of a 403.

### 2. Google OAuth (required for staff sign-in)

1. Same project → Credentials → **Create OAuth client ID → Web application**.
2. Authorised redirect URI: `https://YOUR-DOMAIN/api/auth/callback/google`
   (and `http://localhost:3000/api/auth/callback/google` for local work).
3. Put the client ID and secret in `.env.local`, and list staff emails in the
   `ALLOWLIST_*` variables. An address not on a list cannot sign in at all.

### 3. Anthropic key (required for the AI Inbox)

`ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com).
Everything else works without it; only free-text parsing needs it.

### 4. Run

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

`GET /api/health` reports which of the four integrations are wired up.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel link
vercel env add GOOGLE_SERVICE_ACCOUNT_EMAIL production
vercel env add GOOGLE_PRIVATE_KEY production
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_SECRET production
vercel env add AUTH_SECRET production
vercel env add API_SHARED_TOKEN production
vercel env add ANTHROPIC_API_KEY production
vercel env add ALLOWLIST_ADMIN production
vercel --prod
```

Then set `PUBLIC_BASE_URL` and `NEXTAUTH_URL` to the deployed origin and add the
production callback URL to the OAuth client.

---

## Connect ChatGPT

Custom GPT → Configure → Actions → Import from URL:

```
https://YOUR-DOMAIN/api/openapi
```

Authentication: **API Key**, type **Bearer**, value = `API_SHARED_TOKEN`.

Twelve operations are exposed: `searchJobs`, `createOrUpdateJob`, `getJob`,
`updateJob`, `getReminders`, `createOrUpdateReminder`, `getMaterials`,
`getDailyLogs`, `addDailyLog`, `getTeamAndFleet`, `getTodayPlan`, `submitMessage`.

---

## Connect Claude

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trt-ops": {
      "command": "node",
      "args": ["D:/claude/trt-ops/mcp/server.mjs"],
      "env": {
        "TRT_API_BASE": "https://YOUR-DOMAIN",
        "TRT_API_TOKEN": "your API_SHARED_TOKEN"
      }
    }
  }
}
```

Tools: `search_jobs`, `create_or_update_job`, `update_job_status`,
`assign_crew`, `assign_truck`, `add_material`, `create_or_update_reminder`,
`add_daily_log`, `complete_job`, `get_today_plan`, `get_open_reminders`,
`submit_message`.

---

## Roles

| Role | Can |
|---|---|
| `admin` | everything, including undo and settings |
| `coordinator` | read, write, complete, audit, AI Inbox |
| `technician` | read, submit daily logs, complete own work |
| `readonly` | read only |

Machine callers (bearer token) act as `coordinator`.

---

## Layout

```
src/lib/        schema · sheets · jobs · reminders · logs · team · audit · ai · intake · auth
src/app/api/    jobs · reminders · materials · logs · team · dashboard · audit · ai/intake · openapi · health
src/app/        dashboard · jobs · completed · reminders · materials · logs · team · inbox · audit · login
src/components/ ui primitives · AppShell (sidebar, mobile nav, i18n, theme)
mcp/server.mjs  Claude MCP server
scripts/        trim-logo.js
```

---

## Safety

- No credential ever reaches browser code; all Google access is server-side.
- Every mutation is written to `_TRT_AUDIT_LOG` with previous and new value.
- Field-level changes can be reverted from the Audit page.
- Idempotency keys prevent duplicate records from retried AI calls.
- No unauthenticated endpoint exposes customer data (`/api/health` reports
  wiring status only).
