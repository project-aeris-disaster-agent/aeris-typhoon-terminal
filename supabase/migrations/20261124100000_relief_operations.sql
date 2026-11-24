-- Relief Ops v1: AERIS's Command Board for relief releases that run on ReQuest.
--
-- A relief operation groups pickup sites. Each site links to exactly one
-- ReQuest event (one event per pickup point and time window); AERIS reads its
-- pass counts from the ReQuest Partner API and never stores resident data.
--
-- Apply by hand in the Supabase SQL editor (migration history is out of sync;
-- do not `db push`). Service role only: the dashboard reads and writes these
-- through /api/relief/*, so anon and authenticated get no grants.

create table if not exists public.relief_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  lgu text check (lgu is null or char_length(lgu) <= 120),
  -- Storm name or incident reference the operation responds to.
  incident_ref text check (incident_ref is null or char_length(incident_ref) <= 120),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists relief_operations_status_idx
  on public.relief_operations (status, created_at desc);

create table if not exists public.relief_sites (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.relief_operations (id) on delete cascade,
  request_event_id text not null check (request_event_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  -- The ReQuest event page staff open by hand (v1 has no write access).
  request_event_url text not null check (request_event_url ~ '^https://'),
  barangay text not null check (char_length(barangay) between 2 and 120),
  psgc_code text check (psgc_code is null or psgc_code ~ '^[0-9]{9,10}$'),
  pickup_point text check (pickup_point is null or char_length(pickup_point) <= 160),
  -- Philippines bounding box (config/region.ts PH_BBOX).
  lat double precision check (lat is null or lat between 4.5 and 21.5),
  lon double precision check (lon is null or lon between 116 and 127),
  pickup_start timestamptz,
  pickup_end timestamptz,
  pack_description text check (pack_description is null or char_length(pack_description) <= 200),
  created_by text,
  created_at timestamptz not null default now(),
  constraint relief_sites_window_order check (
    pickup_start is null or pickup_end is null or pickup_end > pickup_start
  ),
  constraint relief_sites_latlon_pair check ((lat is null) = (lon is null)),
  constraint relief_sites_event_once unique (operation_id, request_event_id)
);

create index if not exists relief_sites_operation_idx
  on public.relief_sites (operation_id);

alter table public.relief_operations enable row level security;
alter table public.relief_sites enable row level security;

revoke all on public.relief_operations from anon, authenticated;
revoke all on public.relief_sites from anon, authenticated;
