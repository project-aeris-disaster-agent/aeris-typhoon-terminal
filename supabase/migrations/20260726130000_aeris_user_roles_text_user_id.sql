-- Make aeris_user_roles usable with Privy identities.
--
-- OWNERSHIP: this table is created by AERIS CHAT
-- (06 AERIS CHAT/supabase/migrations/20260521120000_add_ai_triage_and_user_roles.sql)
-- on the database both apps share. It is migrated from here because the
-- dashboard is its only reader — AERIS CHAT creates the table but never
-- queries it. If the two repos ever gain a shared migration home, this belongs
-- there instead.
--
-- ROOT CAUSE
-- The table was designed for Supabase Auth:
--     user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
-- The dashboard has since moved to Privy, whose user ids are DIDs
-- ("did:privy:cm..."). A DID is neither a uuid nor a row in auth.users, so the
-- table could never hold a role for any current dashboard user: reads returned
-- 400 (22P02) and fails-closed to guest_viewer, and writes were rejected the
-- same way. Net effect: nobody could be an admin, which took report review
-- offline entirely.
--
-- Of 89 rows in aeris_user_profiles, 88 are did:privy:* and the only uuid is
-- the DEV_USER_ID constant — there is no uuid population to preserve.
--
-- WHAT THE FOREIGN KEY COST
-- Dropping the auth.users FK removes ON DELETE CASCADE for Supabase-auth
-- users. AERIS CHAT does use Supabase Auth (signUp / signInWithPassword), so
-- auth.users is live for that app — but since it never reads this table, the
-- cascade protected nothing that is actually used, while the constraint
-- actively prevented the table from working for its one consumer.

BEGIN;

-- The self-read policy references user_id, so Postgres refuses ALTER COLUMN
-- TYPE while it exists (0A000: cannot alter type of a column used in a policy
-- definition). Drop, alter, restore.
DROP POLICY IF EXISTS aeris_user_roles_select_own ON public.aeris_user_roles;

-- Drop whatever foreign key sits on user_id, without assuming its name.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.aeris_user_roles'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.aeris_user_roles'::regclass
        AND attname = 'user_id'
    )];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.aeris_user_roles DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

ALTER TABLE public.aeris_user_roles
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- Restored with the cast the new column type requires. auth.uid() is uuid and
-- is NULL for Privy sessions, so this policy grants nothing to dashboard users
-- — role reads go through the service role, which bypasses RLS. It is kept so
-- any Supabase-auth consumer behaves exactly as before.
CREATE POLICY aeris_user_roles_select_own
  ON public.aeris_user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);

COMMIT;
