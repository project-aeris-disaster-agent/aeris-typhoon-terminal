# PAGASA Storm Email Cycles

Automated in-PAR tropical cyclone email updates via the **Minds Watch Officer**, triggered by new [PAGASA Tropical Cyclone Bulletins](https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin) (TCB index via pagasa-parser).

## What it does

1. Polls the PAGASA TCB index on a schedule (and when logged-in users sync).
2. Detects **new cyclones**, **bulletin number increases**, and **final bulletins**.
3. Sends **deterministic email tasks** to your Minds agent (no LLM — minimal cognition).
4. Delivers to **active dashboard users** using the email on their Supabase profile.
5. **Dedupes** per user + cyclone + bulletin number in `aeris_storm_email_log`.

## Email narrative

| Event | Subject pattern |
|-------|-----------------|
| First bulletin (`entered_par`) | `AERIS: {Name} — entered PAR (PAGASA Bulletin #1)` |
| Update | `AERIS: {Name} — PAGASA Bulletin #{n}` |
| Final | `AERIS: {Name} — final PAGASA bulletin (#{n})` |

Opening line for cycle start:

> Tropical Cyclone **{Name}** is now within the Philippine Area of Responsibility (PAR)…

## Recipients

Users receive storm emails when **all** of the following are true:

- `aeris_user_profiles.email` is set (synced from Privy on login)
- `storm_email_enabled = true` (default; toggle in **Profile → Storm email alerts**)
- `last_active_at` within `STORM_EMAIL_ACTIVE_DAYS` (default **7**)

`last_active_at` is updated on every `POST /api/user/sync` (login / app load).

## Cognition / token savings

- **No AERIS CHAT LLM** — bodies are template-generated locally.
- **One Minds message per bulletin event** (all recipients in a single task).
- **Signature cache** — skips polls when the bulletin index unchanged within `STORM_WATCH_MIN_POLL_MS` (default 5 min).
- **DB dedupe** — never resends the same bulletin to the same user.

## Setup

1. Apply migration [`supabase/migrations/20260622100000_storm_watch.sql`](../supabase/migrations/20260622100000_storm_watch.sql).
2. Configure Minds env vars (see [`MINDS_INTEGRATION.md`](MINDS_INTEGRATION.md)).
3. Set `MINDS_NOTIFY_ENABLED=true`.
4. On your Mind (hellominds.ai), ensure **email outbound** is enabled (Telegram/email connected).
5. Log into the dashboard once so your profile email + `last_active_at` are set.

## Polling

| Trigger | When |
|---------|------|
| `GET /api/cron/storm-watch` | Vercel cron `*/15 * * * *` (Pro) |
| `POST /api/user/sync` | Logged-in user activity (`STORM_WATCH_ON_SYNC`, default on) |

**Vercel Hobby** only allows daily crons — rely on the **sync hook** while operators use the dashboard, or upgrade to Pro / call the cron URL from an external scheduler.

### Manual test

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:3000/api/cron/storm-watch?force=true" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

Response fields: `eventsDetected`, `emailsQueued`, `emailsSent`, `recipients`.

## Minds email task format

The Watch Officer receives a structured task:

```
AERIS STORM EMAIL TASK
Send one email per recipient below. Do not reply in chat — email only.

Recipients: ops@example.com
Subject: AERIS: Ester — entered PAR (PAGASA Bulletin #1)

Body:
...
```

Configure your Mind to honor outbound email to the listed addresses (Gmail connection or native Mind email).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `STORM_EMAIL_ACTIVE_DAYS` | 7 | Recipient activity window |
| `STORM_WATCH_MIN_POLL_MS` | 300000 | Poll debounce when index unchanged |
| `STORM_WATCH_ON_SYNC` | true | Poll on user sync |

## Code map

| File | Role |
|------|------|
| [`services/storm-watch-runner.ts`](../services/storm-watch-runner.ts) | Orchestrator |
| [`lib/storm-watch/bulletin-events.ts`](../lib/storm-watch/bulletin-events.ts) | PAGASA diff logic |
| [`lib/storm-watch/email-templates.ts`](../lib/storm-watch/email-templates.ts) | Deterministic copy |
| [`lib/minds-storm-email.ts`](../lib/minds-storm-email.ts) | Minds dispatch |
| [`app/api/cron/storm-watch/route.ts`](../app/api/cron/storm-watch/route.ts) | Cron endpoint |
