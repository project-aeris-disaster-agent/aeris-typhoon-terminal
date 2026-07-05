-- Community report votes (RLHF layer on Live Reports).
--
-- Normal (non-admin) users vote thumbs-up/down on unreviewed disaster reports.
-- Votes feed the gamification loop via the existing award_xp RPC:
--   * casting a vote        -> `vote_report`  XP (once per report per user)
--   * vote matches the admin decision (verify => up, reject => down)
--                           -> `vote_correct` XP at review-settlement time
-- Both awards are idempotent through aeris_xp_events dedupe keys, so changing
-- a vote or re-reviewing a report can never double-award.
--
-- One row per (report, user); the vote is mutable until the report is decided
-- (enforced by the API route, which is the only writer — see RLS below).

CREATE TABLE IF NOT EXISTS public.aeris_report_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.disaster_reports(id) ON DELETE CASCADE,
  -- Privy DID, matching aeris_user_profiles.user_id.
  user_id TEXT NOT NULL,
  -- +1 = thumbs up (looks legitimate), -1 = thumbs down (looks wrong/spam).
  vote SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_aeris_report_votes_report
  ON public.aeris_report_votes (report_id);

CREATE INDEX IF NOT EXISTS idx_aeris_report_votes_user_created
  ON public.aeris_report_votes (user_id, created_at DESC);

ALTER TABLE public.aeris_report_votes ENABLE ROW LEVEL SECURITY;

-- Service-role only, mirroring aeris_user_profiles / aeris_xp_events: all
-- reads and writes go through API routes so the server can enforce voting
-- rules (signed-in, not the reporter, report still undecided).
DROP POLICY IF EXISTS aeris_report_votes_service_all ON public.aeris_report_votes;
CREATE POLICY aeris_report_votes_service_all
  ON public.aeris_report_votes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
