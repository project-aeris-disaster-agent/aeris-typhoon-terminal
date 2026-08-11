-- Set-based vote settlement, replacing a per-voter HTTP loop.
--
-- WHY
-- ---------------------------------------------------------------------------
-- lib/report-votes.ts settleReportVotes() ran inside the admin's review
-- request: it listed up to 1000 winning voters, then called the award_xp RPC
-- once per voter, sequentially, over HTTP. On a report with meaningful
-- community engagement that is up to 1000 serial round-trips inside a function
-- with a 60s cap — the operator's verify action fails, and it fails *after*
-- the report has already been marked verified, so the state is half-applied.
--
-- The awards are a set operation; they only looked like a loop because the
-- only tool to hand was a single-user RPC. This does the whole settlement in
-- one statement.
--
-- Semantics match award_xp() exactly, deliberately:
--   * only users who already have a profile row are awarded (award_xp returns
--     awarded=false for the rest),
--   * aeris_xp_events.dedupe_key is the idempotency key, so re-reviewing a
--     report (reject -> unverify -> verify) never double-pays,
--   * the profile update applies only to rows whose event actually inserted.
--
-- APPLYING THIS FILE
-- ---------------------------------------------------------------------------
-- Run by hand in the Supabase SQL editor. Do NOT `supabase db push`.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.settle_report_votes(
  p_report_id TEXT,
  p_outcome   TEXT,
  p_points    INTEGER DEFAULT 15
)
RETURNS TABLE (settled INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_winning SMALLINT;
  v_settled INTEGER;
BEGIN
  IF p_outcome = 'verified' THEN
    v_winning := 1;
  ELSIF p_outcome = 'rejected' THEN
    v_winning := -1;
  ELSE
    RAISE EXCEPTION
      'settle_report_votes: p_outcome must be verified or rejected, got %',
      p_outcome;
  END IF;

  WITH winners AS (
    SELECT v.user_id
    FROM public.aeris_report_votes v
    -- Inner join reproduces award_xp's "profile must exist" guard.
    JOIN public.aeris_user_profiles p ON p.user_id = v.user_id
    WHERE v.report_id = p_report_id::uuid
      AND v.vote = v_winning
  ),
  inserted AS (
    INSERT INTO public.aeris_xp_events (user_id, action, points, ref_id, dedupe_key)
    SELECT
      w.user_id,
      'vote_correct',
      p_points,
      p_report_id,
      'vote_correct:' || p_report_id || ':' || w.user_id
    FROM winners w
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING user_id
  )
  UPDATE public.aeris_user_profiles pr
  SET xp         = pr.xp + p_points,
      level      = public.aeris_level_from_xp(pr.xp + p_points),
      updated_at = timezone('utc'::text, now())
  FROM inserted i
  WHERE pr.user_id = i.user_id;

  GET DIAGNOSTICS v_settled = ROW_COUNT;
  RETURN QUERY SELECT v_settled;
END;
$$;

COMMENT ON FUNCTION public.settle_report_votes(TEXT, TEXT, INTEGER) IS
  'Awards vote_correct XP to every voter who matched the admin decision, in '
  'one statement. Idempotent via aeris_xp_events.dedupe_key. Called by '
  'lib/report-votes.ts settleReportVotes().';

-- VERIFY:
--   select * from settle_report_votes('<a decided report uuid>', 'verified');
--   -- run it twice; the second call must return settled = 0.
