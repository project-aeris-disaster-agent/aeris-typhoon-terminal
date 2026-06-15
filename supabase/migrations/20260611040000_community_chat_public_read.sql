-- Realtime delivery fix.
--
-- The dashboard authenticates via Privy, so the browser Supabase client holds
-- no Supabase session JWT. Its Realtime socket therefore connects as the
-- `anon` role. postgres_changes enforces RLS against the connecting role, so
-- an `authenticated`-only SELECT policy delivered zero events to clients.
--
-- Chat messages are non-sensitive and the entire app is already gated behind
-- middleware auth, so we allow public (anon + authenticated) reads on the
-- messages table. Profiles remain restricted (never read by the browser).

DROP POLICY IF EXISTS "Authenticated read chat messages"
  ON public.community_chat_messages;

CREATE POLICY "Public read chat messages"
  ON public.community_chat_messages
  FOR SELECT
  USING (true);
