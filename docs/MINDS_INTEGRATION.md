# Minds Integration (Phase 2)

Programmatic integration with [Minds Builder](https://build.hellominds.ai/docs/get-started/account-setup) for **async, proactive** operator alerts. In-panel AGENT AERIS chat and all sync LLM calls remain on **AERIS CHAT** — see [`AGENT_BACKEND.md`](AGENT_BACKEND.md).

**PAGASA storm email cycles:** [`STORM_WATCH_EMAIL.md`](STORM_WATCH_EMAIL.md)

## Architecture split

| Layer | Backend | Use case |
|-------|---------|----------|
| Sync in-panel chat | AERIS CHAT `/api/llm/chat` | Operator Q&A in the terminal |
| Async Watch Officer | Minds Builder API | Proactive weather/triage digests via Telegram/email |
| Live data for Skills | `GET /api/internal/minds/snapshot` | Mind Connections pull structured PH hazard context |
| Mind status | `GET /api/internal/minds/status` | Lifecycle + cognition balance (authorized) |
| Inbound activity | `GET /api/internal/minds/activity` | Recent watch conversation history (authorized) |
| AERIS Reports email | Watch Officer email task | Opt-in daily/breaking briefs to users' inboxes |
| First-Responder partner | Per-user conversations on role Minds | Persistent per-user threads (volunteer / responder / LGU) |

## Prerequisites

1. Create a Mind at [hellominds.ai](https://www.hellominds.ai) (e.g. "AERIS Watch Officer").
2. Issue a **Builder API key** in the Builder console → store as `MINDS_BUILDER_API_KEY`.
3. Copy the Mind's `mindId` from `minds list` → `MINDS_AERIS_MIND_ID`.
4. Connect **Telegram** (or email) on the Mind profile so digests reach operators.
5. Generate a read-only snapshot secret: `openssl rand -hex 32` → `MINDS_API_SECRET`.

Requires **Node 22.x** (`package.json` engines).

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MINDS_BUILDER_API_KEY` | When notify enabled | Builder API auth |
| `MINDS_AERIS_MIND_ID` | When notify enabled | Target Mind for Watch Officer |
| `MINDS_WATCH_ALIAS` | No (default `aeris-watch`) | Stable conversation alias |
| `MINDS_NOTIFY_ENABLED` | No (default off) | Feature flag for cron → Minds pushes |
| `MINDS_API_SECRET` | For snapshot/status/activity APIs | Read-only auth for Mind Connections |
| `MINDS_REPLY_TIMEOUT_MS` | No (default 20000) | Bounded `waitForReply` for critical alerts |
| `MINDS_COGNITION_WARN_THRESHOLD` | No (default 100) | Low-balance warning in cron + status API |
| `MINDS_REPORT_NARRATIVE_ENABLED` | No (default off) | Mind-authored assessment in AERIS Report emails |
| `MINDS_VOLUNTEER_MIND_ID` / `MINDS_RESPONDER_MIND_ID` / `MINDS_LGU_MIND_ID` | No | Role Minds; each falls back to `MINDS_AERIS_MIND_ID` |

## Watch Officer flow

When `MINDS_NOTIFY_ENABLED=true`:

1. **Weather cron** (`GET /api/cron/weather-reports`) generates a daily or breaking brief → [`notifyWatchOfficer`](../lib/minds-watch-officer.ts) sends a formatted digest to the Mind. Daily briefs are fire-and-forget; **breaking briefs use confirmed delivery** (`waitForReply`, bounded by `MINDS_REPLY_TIMEOUT_MS`).
2. **Triage cron** (`GET /api/cron/triage`) sends a digest only when the batch contains **urgent** or **SOS** items — those are critical, so they also use confirmed delivery (bounded by the route's remaining duration budget).

Cron responses include `mindsNotified: boolean` and `mindsConfirmed: boolean | null` (null = fire-and-forget) for observability. The daily cron also runs a `minds-balance` job that logs a warning when the cognition balance drops below `MINDS_COGNITION_WARN_THRESHOLD`.

Minds notify failures are logged but **do not** fail the weather-report or triage cycle.

## Snapshot API (Mind Connections)

```
GET /api/internal/minds/snapshot
Authorization: Bearer ${MINDS_API_SECRET}
```

Optional query params:

- `lat`, `lon` — localize context (nearest region, forecast, facilities)
- `name` — label for the selected location hint

Response: JSON from [`buildAgentLiveContext()`](../lib/agent-context.ts) — national verdict, PAGASA, typhoons, rivers, etc.

### Example curl

```bash
curl -s -H "Authorization: Bearer $MINDS_API_SECRET" \
  "http://localhost:3000/api/internal/minds/snapshot?lat=14.6&lon=121.0&name=Quezon%20City"
```

Configure this URL in **My Connections** on your Minds profile when building an "AERIS Data" Skill.

## Status & activity APIs (authorized)

```
GET /api/internal/minds/status     # mind details + cognition balance + warnings
GET /api/internal/minds/activity   # recent watch conversation history
Authorization: Bearer ${MINDS_API_SECRET}
```

`activity` accepts `?alias=` (default watch alias) and `?limit=` (max 50). These live behind `MINDS_API_SECRET` — not `/api/health` — so unauthenticated hits can't trigger Builder API spend.

## AERIS Reports auto-email

Opt-in email delivery of generated national briefs (daily + breaking) to active users:

1. User enables **AERIS Reports — Weather Briefs by Email** in the profile panel (`aeris_reports_enabled`, opt-in, default off; storm alerts remain a separate toggle).
2. After the daily cron's weather job generates a brief, the `report-emails` job ([`services/aeris-report-email-runner.ts`](../services/aeris-report-email-runner.ts)) selects recipients (active within `STORM_EMAIL_ACTIVE_DAYS`, email present), dedupes against `aeris_report_email_log` (one email per user per report), and sends one Minds email task for the batch.
3. With `MINDS_REPORT_NARRATIVE_ENABLED=true`, the Mind first authors a short "WATCH OFFICER ASSESSMENT" section via bounded `waitForReply` ([`lib/minds-report-author.ts`](../lib/minds-report-author.ts)); on timeout the email ships without it. Data tables stay deterministic either way.

Requires migration `20260713090000_aeris_report_emails.sql`.

## First-Responder partner (per-user conversations)

The Builder API **cannot create Minds** (confirmed against CLI + client-library docs), so per-user partners are implemented as per-user conversation threads on shared **role Minds**:

- Provision up to three Minds manually at hellominds.ai (volunteer / first responder / LGU) and set the role env vars; until then all roles fall back to the Watch Officer Mind.
- [`lib/minds-user-partner.ts`](../lib/minds-user-partner.ts) derives a stable alias per user (`aeris-user-{normalized Privy DID}`), ensures the conversation idempotently, and offers `sendUserPartnerMessage()` with optional bounded reply wait.
- Conversation history (memory) lives with the alias, so each user's thread persists across sessions.

## Admin script

```bash
npx tsx scripts/minds-admin.ts show|enable|disable|balance|usage [hour|day|week|month] [--mind <MIND_ID>]
```

Lifecycle + cognition control without opening hellominds.ai — useful during incidents.

## Skill prompt (manual, hellominds.ai)

Describe to your Mind in Telegram or email:

```text
Build me a Skill that calls my AERIS dashboard snapshot API:
GET {YOUR_DASHBOARD_URL}/api/internal/minds/snapshot
Auth: Bearer {MINDS_API_SECRET}
Return a 3-bullet national situation readout with AERIS risk label and drivers.
Never call national.verdictLabel a PAGASA wind signal.
```

See the [Skill Building Guide](https://build.hellominds.ai/docs/guides/building-skills).

## Smoke test

With env vars set in `.env.local`:

```bash
npx tsx scripts/minds-smoke.ts
```

Verifies: client config, list minds, ensure conversation, send test message, fetch snapshot API locally.

## CLI quick check

```bash
npm install -g @animocabrands/minds-cli
export MINDS_BUILDER_API_KEY=...
minds doctor --pretty
minds list --pretty
```

## Rollout

1. Deploy with `MINDS_NOTIFY_ENABLED=false` (no behavior change).
2. Set secrets on preview; run `scripts/minds-smoke.ts`.
3. Enable notify on preview; trigger weather cron or manual generate route.
4. Confirm digest on Telegram.
5. Register snapshot URL in Mind Connections.
6. Enable `MINDS_NOTIFY_ENABLED=true` in production.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `mindsNotified: false` | `MINDS_NOTIFY_ENABLED`, `MINDS_BUILDER_API_KEY`, `MINDS_AERIS_MIND_ID` |
| Health warning about Minds | Same as above when notify flag is true |
| Snapshot 401 | `MINDS_API_SECRET` and `Authorization: Bearer` header |
| No Telegram message | Mind profile → Telegram connected; cognition balance |
| Cron timeout | Notify is fire-and-forget only; should not block |

## Code map

| File | Role |
|------|------|
| [`lib/minds-config.ts`](../lib/minds-config.ts) | Env helpers, role Minds, dashboard URL |
| [`lib/minds-client.ts`](../lib/minds-client.ts) | Builder API singleton, confirmed delivery, cognition/lifecycle |
| [`lib/minds-watch-officer.ts`](../lib/minds-watch-officer.ts) | Digest formatting + notify (critical → confirmed) |
| [`lib/minds-auth.ts`](../lib/minds-auth.ts) | Internal Minds route auth |
| [`lib/minds-report-author.ts`](../lib/minds-report-author.ts) | Mind-authored report narratives |
| [`lib/minds-user-partner.ts`](../lib/minds-user-partner.ts) | Per-user partner conversations |
| [`lib/aeris-report-email.ts`](../lib/aeris-report-email.ts) | Report email recipients/dedupe/format/dispatch |
| [`services/aeris-report-email-runner.ts`](../services/aeris-report-email-runner.ts) | Report email cycle orchestration |
| [`app/api/internal/minds/snapshot/route.ts`](../app/api/internal/minds/snapshot/route.ts) | Read-only live context |
| [`app/api/internal/minds/status/route.ts`](../app/api/internal/minds/status/route.ts) | Mind status + cognition |
| [`app/api/internal/minds/activity/route.ts`](../app/api/internal/minds/activity/route.ts) | Inbound conversation history |
| [`services/weather-report-runner.ts`](../services/weather-report-runner.ts) | Weather → Minds hook |
| [`app/api/cron/triage/route.ts`](../app/api/cron/triage/route.ts) | Urgent triage → Minds hook |
| [`scripts/minds-admin.ts`](../scripts/minds-admin.ts) | Lifecycle/cognition CLI |

## Phase 2

### Verdict-change alerts (implemented)

When the weather cron runs but **no** daily/breaking brief is generated (`no_trigger` or `breaking_debounced`), the Watch Officer may still ping Minds if:

- AERIS verdict label changed since the last stored brief, or
- Severity score moved by ≥ 5 points, or
- Alert signature shifted while severity remains elevated

Debounced to once every 2 hours unless the jump is ≥ 8 points (same as breaking threshold). Cron JSON includes `mindsNotified: true` and `triggerReason` prefixed with `verdict_change:` when this fires.

### Implemented in Phase 2 (2026-07)

- SDK 0.1.2 (cognition tracking, `getMind`/`updateMindStatus`, `X-Api-Key` auth)
- Confirmed delivery for critical alerts (breaking briefs, urgent/SOS triage)
- Cognition balance monitoring (daily cron job + status API + admin script)
- AERIS Reports auto-email with optional Mind-authored narrative
- Per-user partner conversations on role Minds (`aeris-user-{did}` aliases)
- Inbound activity API (Mind → dashboard history)

### Still planned

- Replace in-panel chat with Minds (latency/citation risk)
- SSE streaming to AGENT AERIS panel (`subscribeEvents` — activity API polls for now)
- Bazaar Skill publication automation (blocked: no Equip HTTP API upstream)
- Programmatic per-user Minds (blocked: Builder API has no create-Mind endpoint)
