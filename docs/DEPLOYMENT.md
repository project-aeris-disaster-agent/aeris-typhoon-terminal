# Production deployment

## Pre-deploy gates

```bash
npm ci
npm run predeploy   # typecheck → jest → build → playwright
npm audit --audit-level=high   # must report 0 high/critical
```

`npm audit` at default level still reports ~10 **moderate** advisories, all of
them inside the `@reown/appkit` + `@walletconnect` tree that
`@privy-io/react-auth` pulls in transitively. They have no upgrade path that
does not require a Privy major, so the CI gate is set at `high`. Re-check on
each Privy bump; do not relax the gate below `high`.

The `overrides` block in `package.json` is load-bearing — it pins patched
`ws`, `axios`, `test-exclude`, `glob`, `postcss`, `sharp`, and (scoped to
eslint) `brace-expansion`. Removing an entry will reintroduce an advisory or,
in `test-exclude`'s case, silently break `npm run test:coverage`.

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
- Crons require `CRON_SECRET` (Vercel injects for scheduled invocations). All
  privileged routes (`/api/cron/*`, `/api/internal/*`) are secure-by-default:
  with no secret configured they return **401**, never run open.
- Node **22.x** on Vercel (`package.json` engines).
- E2E smoke runs with `DASHBOARD_AUTH_DISABLED=true`. With auth enabled, `/`
  redirects to `/login`, so the map-canvas assertion only holds when auth is off.

## Local gotcha: never run `dev` and `start` together

`next dev` and `next start` share the same `.next/` directory. Running both
against this checkout at once corrupts the build output and surfaces as runtime
**500s** with `Error: Cannot find module './NNN.js'` (webpack chunk mismatch) —
this is NOT an application bug. Before `npm run start` / `npm run test:e2e`
locally, stop any `next dev`, then `rm -rf .next && npm run build`. On Vercel
every deployment has an isolated build, so this never occurs in production.

## Rollback

Vercel → promote previous deployment, or `git revert` + redeploy. Supabase/KV data is not rolled back.

## Stack versions (verify in lockfile)

- Next.js **15.5.x** (App Router; dynamic route `params` are async)
- Jest unit tests + Playwright `e2e/smoke.spec.ts` against production build

## Not automated

- Mobile FPS / tile CDN latency under load
- Full removal of Jest boundary mocks (Supabase, satellite-frames in component tests)
- External log drain / APM (configure on Vercel separately)
