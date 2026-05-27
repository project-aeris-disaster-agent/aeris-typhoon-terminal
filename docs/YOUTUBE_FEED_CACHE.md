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

Migration file: `supabase/migrations/20260527120000_youtube_feed_channel_cache.sql`

Creates:

- `public.youtube_feed_channel_cache` — enriched feed per channel (primary cache)
- `public.youtube_feed_cache` — optional `search.list` live-only cache

### Apply (pick one)

**Supabase Dashboard → SQL Editor** — paste the full migration file and run.

**Supabase CLI** (linked project):

```bash
supabase db push
```

**Cursor Supabase MCP** — `apply_migration` with name `youtube_feed_channel_cache` and the SQL from the file.

### Verify (production)

```sql
select channel_handle,
       jsonb_array_length(videos) as n,
       expires_at > now() as fresh,
       errors
from public.youtube_feed_channel_cache
order by channel_handle;
```

Expect four rows (`gmanews2026`, `abscbnnews`, `OneNewsPH`, `JazBazPhilippines`) after the dashboard loads once.

If `live-search: search.list HTTP 429` appears in `errors`, the API daily quota is exhausted for **search.list** (100 units/call). The app then:

1. Scrapes `/@handle/streams` and runs **videos.list** on tab video IDs (~1 unit) to find all concurrent live streams.
2. Falls back to single-stream HTML scrape if that also fails.
3. **Does not overwrite** a Supabase channel cache that had more live streams than a degraded poll returned.

Until quota resets, you may still see the 429 message in `errors` even when streams load correctly.

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
