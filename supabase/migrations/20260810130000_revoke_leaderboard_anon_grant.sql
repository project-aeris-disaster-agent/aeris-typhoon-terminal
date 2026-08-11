-- Follow-up to 20260810120000: actually revoke the leaderboard grant.
--
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
-- 20260810120000 ordered its statements REVOKE → DROP VIEW → CREATE VIEW. The
-- revoke applied to the *old* view and was then discarded along with it, and
-- Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated` on the public schema re-granted SELECT to the new one the
-- moment it was created. Verified against the live database with the public
-- anon key after that migration was applied:
--
--   GET /rest/v1/aeris_leaderboard?select=*  ->  200, rows returned
--   GET /rest/v1/aeris_leaderboard?select=user_id -> 400 (column does not exist)
--
-- So the part that mattered did land — `user_id` (the Privy DID) is gone from
-- the projection, which was the actual data exposure. What remained readable
-- was username/level/xp/rank.
--
-- A grant must be revoked AFTER the object it applies to exists. This file is
-- ordering-safe on its own and idempotent on replay.
--
-- APPLYING THIS FILE
-- ---------------------------------------------------------------------------
-- Run by hand in the Supabase SQL editor. Do NOT `supabase db push`.

BEGIN;

-- The view already has the right shape (no user_id) after 20260810120000;
-- re-assert it anyway so this file is correct when replayed from scratch.
CREATE OR REPLACE VIEW public.aeris_leaderboard AS
SELECT
  username,
  level,
  xp,
  ROW_NUMBER() OVER (ORDER BY xp DESC, username ASC) AS rank
FROM public.aeris_user_profiles
ORDER BY xp DESC;

-- Now revoke, with the view in its final state. Also block the default
-- privilege from re-granting on any future CREATE OR REPLACE of this view.
REVOKE ALL ON public.aeris_leaderboard FROM anon, authenticated;

COMMIT;

-- VERIFY (with the anon key — the one in the client bundle):
--
--   curl "$SUPABASE_URL/rest/v1/aeris_leaderboard?select=*&limit=1" \
--     -H "apikey: $ANON" -H "authorization: Bearer $ANON"
--
--   expect: 401/403 with a permission-denied message, NOT 200 with rows.
--
-- If it still returns 200, the schema-level default privilege is re-granting.
-- Check with:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'aeris_leaderboard';
