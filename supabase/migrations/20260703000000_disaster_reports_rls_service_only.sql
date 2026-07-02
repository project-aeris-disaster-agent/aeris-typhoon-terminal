-- Security hardening: ensure disaster_reports is not readable/writable with the
-- public anon key.
--
-- WHY: rows carry ip_hash and metadata.anonymousId (and, for verified reports,
-- verified phone numbers). All real access to this table happens server-side
-- with the SERVICE ROLE key (lib/supabase-reports.ts in the dashboard,
-- lib/reports/shared-supabase.ts in AERIS CHAT), which BYPASSES RLS. No browser
-- code queries disaster_reports directly with the anon key. Enabling RLS with a
-- service-role-only policy therefore closes any direct anon-key read/write of
-- report PII without affecting the apps.
--
-- ⚠️ REVIEW BEFORE APPLYING: the base disaster_reports table and any existing
-- policies were created outside these tracked migrations, so the current RLS
-- state is not visible here. Confirm against production that:
--   (1) no browser/anon path reads disaster_reports directly, and
--   (2) any intended PUBLIC map/report read is served through a server route
--       (service role) or gets its own explicit, column-safe policy.
-- If a public read is required, add a dedicated policy that exposes ONLY safe
-- columns (never ip_hash / metadata / phone) via a view — do not open the raw
-- table.

ALTER TABLE public.disaster_reports ENABLE ROW LEVEL SECURITY;

-- Explicit service-role-only access. (The service role already bypasses RLS;
-- this policy documents intent and covers any future non-superuser service.)
DROP POLICY IF EXISTS disaster_reports_service_all ON public.disaster_reports;
CREATE POLICY disaster_reports_service_all
  ON public.disaster_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
