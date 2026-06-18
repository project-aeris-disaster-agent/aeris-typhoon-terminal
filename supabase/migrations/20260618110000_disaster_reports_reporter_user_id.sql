-- Carry the reporter's Privy DID (TEXT) on every report so XP can be awarded
-- to the author when their report is verified. The existing user_id column is
-- UUID (Supabase-auth users) and cannot store Privy DIDs like 'did:privy:...'.

ALTER TABLE public.disaster_reports
  ADD COLUMN IF NOT EXISTS reporter_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_disaster_reports_reporter_user_id
  ON public.disaster_reports (reporter_user_id)
  WHERE reporter_user_id IS NOT NULL;

COMMENT ON COLUMN public.disaster_reports.reporter_user_id IS
  'Privy DID of the authenticated reporter (aeris_user_profiles.user_id). Null for anonymous reports.';
