-- Per-channel YouTube feed cache (Option A: single-writer refresh, many readers).
create table if not exists public.youtube_feed_channel_cache (
  channel_handle text primary key,
  videos jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  refreshing_until timestamptz
);

create index if not exists youtube_feed_channel_cache_expires_at_idx
  on public.youtube_feed_channel_cache (expires_at);

comment on table public.youtube_feed_channel_cache is
  'Enriched YouTube feed per channel; refreshed by cron or stale-while-revalidate on read.';

-- Legacy table used for search.list live-only cache (optional; keep if already deployed).
create table if not exists public.youtube_feed_cache (
  channel_id text primary key,
  channel_handle text,
  videos jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
