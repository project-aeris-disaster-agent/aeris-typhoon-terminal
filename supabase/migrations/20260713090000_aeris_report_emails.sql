-- AERIS Reports auto-email (Minds Watch Officer).
-- Opt-in delivery of generated national weather briefs to active users,
-- deduped per user per report. Mirrors the storm email cycle tables.

-- Opt-in (unlike storm_email_enabled, which is opt-out): general report mail
-- is broader than cyclone alerts, so users must enable it explicitly.
ALTER TABLE public.aeris_user_profiles
  ADD COLUMN IF NOT EXISTS aeris_reports_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_aeris_user_profiles_aeris_reports
  ON public.aeris_user_profiles (aeris_reports_enabled, last_active_at DESC)
  WHERE email IS NOT NULL;

-- Dedupe: one email per user per generated report.
CREATE TABLE IF NOT EXISTS public.aeris_report_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL,
  report_type TEXT NOT NULL
    CHECK (report_type IN ('daily', 'breaking')),
  user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  minds_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aeris_report_email_log_created
  ON public.aeris_report_email_log (created_at DESC);

ALTER TABLE public.aeris_report_email_log ENABLE ROW LEVEL SECURITY;
