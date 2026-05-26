# YouTube feed cache (Option A)

Shared Supabase cache so many dashboard users share **one** YouTube API budget.

## Prerequisites

In `.env` / Vercel (Production):

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (server only; never expose to client) |
| `YOUTUBE_API_KEY` | Optional (scrape-only if unset) |
| `CRON_SECRET` | Yes for `/api/cron/youtube-feed` |

## Database

Apply migration:

`supabase/migrations/20260527120000_youtube_feed_channel_cache.sql`

Table: `public.youtube_feed_channel_cache` (one row per channel handle).

Verify:

```sql
select channel_handle, jsonb_array_length(videos), expires_at > now() as fresh
from public.youtube_feed_channel_cache;
```

## Channel list

Defined once in `lib/youtube-feed/constants.ts` (`MONITORED_YOUTUBE_HANDLES`).

## How it works

1. Browser polls **once** every 90s via `YouTubeFeedsProvider` (all monitored channels).
2. `GET /api/youtube-feed` reads Supabase; if stale, **one** request acquires a lock and polls YouTube.
3. Other users get cached JSON (edge `s-maxage=60`).
4. Daily Vercel cron `GET /api/cron/youtube-feed` refreshes all monitored channels (Hobby: once/day).

## Warm cache manually

```bash
curl "https://YOUR-DASHBOARD/api/youtube-feed?channels=gmanews2026,abscbnnews,OneNewsPH,JazBazPhilippines"
```

Or with cron auth:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR-DASHBOARD/api/cron/youtube-feed"
```

## Local dev

- Without Supabase env: polls YouTube on every request (old behavior).
- With Supabase env: same as production cache path.

## Deploy checklist

- [ ] Migration applied on production Supabase
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set on Vercel
- [ ] Redeploy so `vercel.json` registers `/api/cron/youtube-feed` (07:00 UTC daily)
- [ ] Open dashboard → Intel Feeds → confirm streams load
- [ ] Confirm cache rows populate in Supabase after first load
