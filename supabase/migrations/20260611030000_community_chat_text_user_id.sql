-- Privy is the primary auth provider; its user ids are DID strings
-- (e.g. "did:privy:clxxxx..."), not UUIDs. The community chat tables were
-- created with UUID user_id columns, which rejects Privy ids with a 22P02
-- error. Widen them to TEXT so both Privy and Supabase ids are accepted.

ALTER TABLE public.community_chat_profiles
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE public.community_chat_messages
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;
