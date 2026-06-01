# Production deployment

## Pre-deploy gates

```bash
npm ci
npm run predeploy   # typecheck → jest → build → playwright
npm audit           # expect 0 vulnerabilities at current lockfile
```

Optional: `npm run smoke:reports` (Supabase `.env` required).

CI: `.github/workflows/ci.yml` runs the same gates on push/PR.

## Health check

`GET /api/health`

| Environment | HTTP | `ok` when |
|-------------|------|-----------|
| `VERCEL_ENV=production` | 503 if misconfigured | KV + `CRON_SECRET` + Supabase (unless `DASHBOARD_AUTH_DISABLED`) |
| preview / local | 200 | warnings only for missing optional env |

Uptime probes should fail on status **503** or `"ok": false`.

## Assumptions

- Production is `VERCEL_ENV=production`.
- Multi-instance deploys require Vercel KV (not in-memory fallback).
- Crons require `CRON_SECRET` (Vercel injects for scheduled invocations).
- Node **20.x** on Vercel (`package.json` engines).

## Rollback

Vercel → promote previous deployment, or `git revert` + redeploy. Supabase/KV data is not rolled back.

## Stack versions (verify in lockfile)

- Next.js **15.5.x** (App Router; dynamic route `params` are async)
- Jest unit tests + Playwright `e2e/smoke.spec.ts` against production build

## Not automated

- Mobile FPS / tile CDN latency under load
- Full removal of Jest boundary mocks (Supabase, satellite-frames in component tests)
- External log drain / APM (configure on Vercel separately)
