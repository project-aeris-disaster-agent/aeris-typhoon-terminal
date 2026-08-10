-- Close the anon-key read paths that bypass the dashboard's auth gate.
--
-- WHY
-- ---------------------------------------------------------------------------
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships inside the client bundle by design
-- (verified: it is present in .next/static/chunks/app/page-*.js). Anyone who
-- opens the site's JavaScript can call PostgREST directly with it. Such a call
-- never passes through middleware.ts, so "the whole app is behind auth" is not
-- a control over anything the `anon` role can SELECT.
--
-- Three grants were reachable that way. This migration closes all three
-- without breaking the one feature that genuinely needs anon reads.
--
-- APPLYING THIS FILE
-- ---------------------------------------------------------------------------
-- This project's migration history is out of sync with the remote, so run this
-- by hand in the Supabase SQL editor. Do NOT `supabase db push`.
-- Every statement is idempotent and safe to replay.
--
-- ORDERING BUG — see 20260810130000
-- ---------------------------------------------------------------------------
-- Section 1 below revokes the leaderboard grant BEFORE dropping and recreating
-- the view, so the revoke dies with the old object and Supabase's default
-- privileges re-grant SELECT to `anon` on the new one. The `user_id` removal
-- (the part that mattered) works; the revoke does not.
-- 20260810130000_revoke_leaderboard_anon_grant.sql fixes it. Left as-is here
-- rather than edited, because this file has already been applied.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. aeris_leaderboard — exposed every user's Privy DID to the internet.
-- ---------------------------------------------------------------------------
-- The view selected `user_id` (a `did:privy:...` string that identifies the
-- account across this app and AERIS CHAT) and was granted to `anon`. Worse, a
-- Postgres view defaults to `security_invoker = false`, so it executes as its
-- owner and *bypasses* the RLS on `aeris_user_profiles` — silently undoing the
-- "base tables are service-role only (they hold PII)" rule that the view's own
-- migration states two lines above the GRANT.
--
-- No code reads this view: a repo-wide search for `aeris_leaderboard` returns
-- only the migration that created it. It was pure exposed surface.
--
-- Fix: drop `user_id` from the projection and revoke the anon/authenticated
-- grants. The view stays for service-role use. A future leaderboard UI should
-- read it through an API route, exactly as every other profile read already
-- does (see app/api/user/profile) — the browser holds no Supabase JWT (it
-- authenticates with Privy), so an `authenticated` grant would not help it
-- anyway.
REVOKE SELECT ON public.aeris_leaderboard FROM anon, authenticated;

DROP VIEW IF EXISTS public.aeris_leaderboard;

CREATE VIEW public.aeris_leaderboard AS
SELECT
  username,
  level,
  xp,
  ROW_NUMBER() OVER (ORDER BY xp DESC, username ASC) AS rank
FROM public.aeris_user_profiles
ORDER BY xp DESC;

COMMENT ON VIEW public.aeris_leaderboard IS
  'Public-safe leaderboard projection: display name, level, xp, rank. Never '
  'user_id/email/phone/wallet. Service-role only — serve it through an API '
  'route, do not grant to anon or authenticated.';

-- ---------------------------------------------------------------------------
-- 2. aeris_agent_messages — anon could read every AGENT AERIS reply.
-- ---------------------------------------------------------------------------
-- The policy allowed `USING (source IN ('assistant','system','weather_report'))`
-- for all roles including anon, so the public key could pull the assistant side
-- of every user's AGENT AERIS conversation.
--
-- Nothing needs it. The only browser Realtime subscription in the codebase is
-- the community-chat channel (components/panels/CommunityChatRoom.tsx); this
-- table is read exclusively server-side by lib/supabase-agent.ts, which
-- supplies its own key. Dropping the policy leaves the table service-role only,
-- like disaster_reports and aeris_user_profiles.
DROP POLICY IF EXISTS "Public read agent broadcast messages"
  ON public.aeris_agent_messages;

-- ---------------------------------------------------------------------------
-- 3. community_chat_messages — anon could download the entire chat archive.
-- ---------------------------------------------------------------------------
-- Unlike the two above, this one cannot simply be revoked. Supabase Realtime
-- enforces RLS against the *connecting* role, and the browser client connects
-- as `anon` because the dashboard authenticates with Privy and therefore holds
-- no Supabase session JWT. An `authenticated`-only policy delivers zero events
-- — that is exactly the bug 20260611040000 was written to fix.
--
-- But Realtime `postgres_changes` only needs to deliver *new* rows. History is
-- loaded over HTTP by lib/community-chat.ts using the service role, which is
-- unaffected by RLS. So the anon read can be narrowed to a short recent window
-- in the one live room: realtime delivery keeps working, while "fetch the whole
-- archive with the public key" stops.
DROP POLICY IF EXISTS "Public read chat messages"
  ON public.community_chat_messages;

CREATE POLICY "Realtime read recent chat messages"
  ON public.community_chat_messages
  FOR SELECT
  USING (
    room = 'global'
    AND created_at > (timezone('utc'::text, now()) - interval '10 minutes')
  );

COMMIT;

-- VERIFY (run with the anon key, e.g. from the browser console or curl):
--
--   -- expect: 401/permission denied
--   select * from aeris_leaderboard limit 1;
--
--   -- expect: 0 rows
--   select * from aeris_agent_messages limit 1;
--
--   -- expect: only messages from the last 10 minutes
--   select created_at from community_chat_messages order by created_at desc;
--
-- Then confirm in the app that community chat still delivers new messages
-- live to a second browser window.
