# Minds Integration (Phase 1)

Programmatic integration with [Minds Builder](https://build.hellominds.ai/docs/get-started/account-setup) for **async, proactive** operator alerts. In-panel AGENT AERIS chat and all sync LLM calls remain on **AERIS CHAT** — see [`AGENT_BACKEND.md`](AGENT_BACKEND.md).

**PAGASA storm email cycles:** [`STORM_WATCH_EMAIL.md`](STORM_WATCH_EMAIL.md)

## Architecture split

| Layer | Backend | Use case |
|-------|---------|----------|
| Sync in-panel chat | AERIS CHAT `/api/llm/chat` | Operator Q&A in the terminal |
| Async Watch Officer | Minds Builder API | Proactive weather/triage digests via Telegram/email |
| Live data for Skills | `GET /api/internal/minds/snapshot` | Mind Connections pull structured PH hazard context |

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
| `MINDS_API_SECRET` | For snapshot API | Read-only auth for Mind Connections |

## Watch Officer flow

When `MINDS_NOTIFY_ENABLED=true`:

1. **Weather cron** (`GET /api/cron/weather-reports`) generates a daily or breaking brief → [`notifyWatchOfficer`](../lib/minds-watch-officer.ts) sends a formatted digest to the Mind (fire-and-forget, no `waitForReply`).
2. **Triage cron** (`GET /api/cron/triage`) sends a digest only when the batch contains **urgent** or **SOS** items.

Cron responses include `mindsNotified: boolean` for observability.

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
| [`lib/minds-config.ts`](../lib/minds-config.ts) | Env helpers, dashboard URL |
| [`lib/minds-client.ts`](../lib/minds-client.ts) | Builder API singleton |
| [`lib/minds-watch-officer.ts`](../lib/minds-watch-officer.ts) | Digest formatting + notify |
| [`lib/minds-auth.ts`](../lib/minds-auth.ts) | Snapshot route auth |
| [`app/api/internal/minds/snapshot/route.ts`](../app/api/internal/minds/snapshot/route.ts) | Read-only live context |
| [`services/weather-report-runner.ts`](../services/weather-report-runner.ts) | Weather → Minds hook |
| [`app/api/cron/triage/route.ts`](../app/api/cron/triage/route.ts) | Urgent triage → Minds hook |

## Phase 2

### Verdict-change alerts (implemented)

When the weather cron runs but **no** daily/breaking brief is generated (`no_trigger` or `breaking_debounced`), the Watch Officer may still ping Minds if:

- AERIS verdict label changed since the last stored brief, or
- Severity score moved by ≥ 5 points, or
- Alert signature shifted while severity remains elevated

Debounced to once every 2 hours unless the jump is ≥ 8 points (same as breaking threshold). Cron JSON includes `mindsNotified: true` and `triggerReason` prefixed with `verdict_change:` when this fires.

### Still planned

- Replace in-panel chat with Minds (latency/citation risk)
- SSE streaming to AGENT AERIS panel
- Bazaar Skill publication automation
- Per-operator Mind aliases tied to Privy DIDs
