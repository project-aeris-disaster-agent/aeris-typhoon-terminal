-- PAGASA bulletin-driven storm email cycles (Minds Watch Officer).
-- Tracks per-cyclone bulletin progress and dedupes emails per user/bulletin.

ALTER TABLE public.aeris_user_profiles
  ADD COLUMN IF NOT EXISTS storm_email_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_aeris_user_profiles_storm_email
  ON public.aeris_user_profiles (storm_email_enabled, last_active_at DESC)
  WHERE email IS NOT NULL;

-- One row per active cyclone slug (e.g. "ester").
CREATE TABLE IF NOT EXISTS public.aeris_storm_watch_cycles (
  cyclone_slug TEXT PRIMARY KEY,
  cyclone_name TEXT NOT NULL,
  last_bulletin_number INTEGER NOT NULL DEFAULT 0,
  last_bulletin_final BOOLEAN NOT NULL DEFAULT false,
  last_pdf_url TEXT,
  cycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (cycle_status IN ('active', 'completed')),
  entered_par_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Dedupe: one email per user per bulletin issuance.
CREATE TABLE IF NOT EXISTS public.aeris_storm_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cyclone_slug TEXT NOT NULL,
  bulletin_number INTEGER NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('entered_par', 'bulletin_update', 'final')),
  user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  minds_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (cyclone_slug, bulletin_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aeris_storm_email_log_created
  ON public.aeris_storm_email_log (created_at DESC);

-- Global poll watermark (singleton row).
CREATE TABLE IF NOT EXISTS public.aeris_storm_watch_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_polled_at TIMESTAMPTZ,
  last_bulletin_signature TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.aeris_storm_watch_meta (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
