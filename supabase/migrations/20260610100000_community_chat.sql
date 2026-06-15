-- Community Chat: single global room, MIRC-style peer chat.
--
-- Messages are written exclusively by the API (service role) after
-- sanitization / rate limiting; clients only read. Realtime delivery is
-- provided via the supabase_realtime publication on the messages table.

CREATE TABLE IF NOT EXISTS public.community_chat_profiles (
  user_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- MIRC-style nick collisions are rejected (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_chat_profiles_nick_lower
  ON public.community_chat_profiles (lower(display_name));

CREATE TABLE IF NOT EXISTS public.community_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room TEXT NOT NULL DEFAULT 'global',
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_community_chat_messages_room_created
  ON public.community_chat_messages (room, created_at DESC);

ALTER TABLE public.community_chat_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_chat_messages ENABLE ROW LEVEL SECURITY;

-- Reads: any authenticated session (anon key + session JWT). Writes happen
-- only via the service role from API routes, so no INSERT policies exist.
CREATE POLICY "Authenticated read chat messages"
  ON public.community_chat_messages
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated read chat profiles"
  ON public.community_chat_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Realtime fan-out for INSERTs on the messages table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_chat_messages;
  END IF;
END $$;
