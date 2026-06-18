-- User profiles + gamification (XP / levels 0-99).
--
-- Profiles are synced from Privy on login (keyed by the Privy DID, stored as
-- TEXT to match the precedent set by community_chat). All writes happen via the
-- service role from API routes, so the base tables expose no anon/authenticated
-- policies (they hold PII: email, phone, wallet). A column-restricted
-- leaderboard VIEW exposes only the public-safe username/level/xp for any
-- future client-side leaderboard.

CREATE TABLE IF NOT EXISTS public.aeris_user_profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  username TEXT NOT NULL,
  proxy_wallet_address TEXT,
  wallet_chain TEXT NOT NULL DEFAULT 'skale-base',
  barangay TEXT,
  phone TEXT,
  socials JSONB NOT NULL DEFAULT '{}'::jsonb,
  avatar_url TEXT,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Case-insensitive unique usernames (MIRC-style, mirrors community_chat nicks).
CREATE UNIQUE INDEX IF NOT EXISTS idx_aeris_user_profiles_username_lower
  ON public.aeris_user_profiles (lower(username));

CREATE INDEX IF NOT EXISTS idx_aeris_user_profiles_xp
  ON public.aeris_user_profiles (xp DESC);

-- XP ledger: audit trail + idempotency. A non-null dedupe_key guarantees an
-- action (e.g. verifying a specific report) is only ever rewarded once.
CREATE TABLE IF NOT EXISTS public.aeris_xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  points INTEGER NOT NULL,
  ref_id TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aeris_xp_events_dedupe_key
  ON public.aeris_xp_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aeris_xp_events_user_created
  ON public.aeris_xp_events (user_id, created_at DESC);

-- Level curve: cumulative XP required to reach level L is 25 * L * (L + 1).
-- L=1 -> 50, L=2 -> 150, ... L=99 -> 247,500. Capped at 99.
CREATE OR REPLACE FUNCTION public.aeris_level_from_xp(p_xp INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lvl INTEGER;
BEGIN
  IF p_xp IS NULL OR p_xp <= 0 THEN
    RETURN 0;
  END IF;

  -- Closed-form estimate, then correct any floating-point edge cases.
  lvl := floor((-1 + sqrt(1 + (4.0 * p_xp) / 25.0)) / 2.0);
  IF lvl < 0 THEN
    lvl := 0;
  END IF;

  WHILE 25 * (lvl + 1) * (lvl + 2) <= p_xp LOOP
    lvl := lvl + 1;
  END LOOP;
  WHILE lvl > 0 AND 25 * lvl * (lvl + 1) > p_xp LOOP
    lvl := lvl - 1;
  END LOOP;

  IF lvl > 99 THEN
    lvl := 99;
  END IF;
  RETURN lvl;
END;
$$;

-- Atomically record an XP event and apply it to the profile. Idempotent on
-- dedupe_key. Returns the resulting totals and whether the award was applied.
CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id TEXT,
  p_action TEXT,
  p_points INTEGER,
  p_dedupe_key TEXT DEFAULT NULL,
  p_ref_id TEXT DEFAULT NULL
)
RETURNS TABLE (xp INTEGER, level INTEGER, leveled_up BOOLEAN, awarded BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_level INTEGER;
  v_new_xp INTEGER;
  v_new_level INTEGER;
  v_rows INTEGER;
BEGIN
  -- Lock the profile row; awards require an existing profile.
  SELECT aup.level INTO v_old_level
  FROM public.aeris_user_profiles aup
  WHERE aup.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, FALSE, FALSE;
    RETURN;
  END IF;

  INSERT INTO public.aeris_xp_events (user_id, action, points, ref_id, dedupe_key)
  VALUES (p_user_id, p_action, p_points, p_ref_id, p_dedupe_key)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Duplicate award; return current totals unchanged.
    SELECT aup.xp, aup.level INTO v_new_xp, v_new_level
    FROM public.aeris_user_profiles aup
    WHERE aup.user_id = p_user_id;
    RETURN QUERY SELECT v_new_xp, v_new_level, FALSE, FALSE;
    RETURN;
  END IF;

  UPDATE public.aeris_user_profiles
  SET xp = xp + p_points,
      level = public.aeris_level_from_xp(xp + p_points),
      updated_at = timezone('utc'::text, now())
  WHERE user_id = p_user_id
  RETURNING aeris_user_profiles.xp, aeris_user_profiles.level
  INTO v_new_xp, v_new_level;

  RETURN QUERY SELECT v_new_xp, v_new_level, (v_new_level > v_old_level), TRUE;
END;
$$;

ALTER TABLE public.aeris_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aeris_xp_events ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: base tables are service-role only (they hold
-- PII). The dashboard reads/writes profiles exclusively through API routes.

-- Public-safe leaderboard: only username/level/xp, never email/phone/wallet.
CREATE OR REPLACE VIEW public.aeris_leaderboard AS
SELECT
  user_id,
  username,
  level,
  xp
FROM public.aeris_user_profiles
ORDER BY xp DESC;

GRANT SELECT ON public.aeris_leaderboard TO anon, authenticated;
