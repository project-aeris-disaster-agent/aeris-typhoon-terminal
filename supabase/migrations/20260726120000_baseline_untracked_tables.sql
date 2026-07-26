-- Baseline for tables this app depends on that had NO tracked migration.
--
-- WHY THIS FILE EXISTS
-- ---------------------------------------------------------------------------
-- `disaster_reports`, `aeris_user_roles`, and `report_review_events` were
-- created outside version control (Supabase SQL editor). Until now the schema
-- for the app's most important table could not be rebuilt from this repo, and
-- the RLS hardening in 20260703000000 had to ship with a "REVIEW BEFORE
-- APPLYING" warning because the base table was invisible here.
--
-- SCOPE AND LIMITS — READ BEFORE TRUSTING THIS FILE
-- ---------------------------------------------------------------------------
-- Reconstructed by introspecting the live PostgREST schema (columns, types,
-- nullability, primary keys, foreign keys). PostgREST does NOT expose column
-- DEFAULTs, CHECK constraints, indexes, or triggers, so those are best-effort
-- and marked below. This file is:
--   * SAFE to apply (every statement is IF NOT EXISTS / idempotent),
--   * AUTHORITATIVE for column names and types,
--   * NOT authoritative for defaults, constraints, or indexes.
--
-- To replace this with a byte-exact baseline, dump the real DDL:
--     npx supabase db dump --schema public -f supabase/migrations/00000000000000_baseline.sql
-- and delete this file.
--
-- SHARED OWNERSHIP
-- ---------------------------------------------------------------------------
-- This Supabase project is shared with the AERIS CHAT app. `chat_sessions`,
-- `messages`, and `users` are owned by that repo; `disaster_reports` carries
-- foreign keys into them. Those FKs are intentionally NOT recreated here —
-- adding them from this repo would make the dashboard's migration history
-- depend on another app's tables existing first.

-- ---------------------------------------------------------------------------
-- disaster_reports — crowdsourced incident reports (shared with AERIS CHAT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.disaster_reports (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance
  source_app                text NOT NULL,
  source_channel            text NOT NULL,

  -- Report content
  category                  text NOT NULL,
  description               text NOT NULL,
  longitude                 double precision NOT NULL,
  latitude                  double precision NOT NULL,
  location_accuracy_m       double precision,
  address_text              text,
  photo_url                 text,

  -- Triage / moderation state
  severity                  text NOT NULL,
  confidence                numeric NOT NULL,
  verification_status       text NOT NULL,
  moderation_status         text NOT NULL,
  confirmations             integer NOT NULL DEFAULT 0,
  reviewed_by               text,
  reviewed_at               timestamptz,
  review_actor_type         text,
  operator_note             text,

  -- Reporter identity. NOTE the split: `user_id` is a Supabase auth uuid,
  -- `reporter_user_id` is a Privy DID (text). See the warning at the bottom.
  user_id                   uuid,
  reporter_user_id          text,
  anonymous_id              text,
  ip_hash                   text,

  -- FKs into AERIS CHAT tables; constraints deliberately omitted (see header).
  session_id                uuid,
  message_id                uuid,
  report_message_id         text,

  -- AI triage
  ai_priority               text NOT NULL,
  ai_triage_at              timestamptz,
  ai_triage_rationale       text,
  ai_triage_confidence      numeric,
  dedupe_hash               text,

  phone_verification_status text NOT NULL,

  -- On-chain mint pipeline
  proxy_wallet_id           uuid,
  proxy_wallet_address      text,
  onchain_network           text NOT NULL,
  onchain_chain_id          integer NOT NULL,
  onchain_mint_status       text NOT NULL,
  onchain_tx_hash           text,
  onchain_token_id          text,
  onchain_minted_at         timestamptz,

  -- Privacy commitments (see lib/onchain/commitments.ts). Only the hashes are
  -- minted; geo_salt never leaves the database.
  geo_salt                  text,
  geo_commitment            text,
  description_commitment    text,
  photo_commitment          text,

  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Best-effort indexes matching the app's actual query patterns
-- (lib/supabase-reports.ts). Safe to add; verify against production before
-- assuming these are the only ones.
CREATE INDEX IF NOT EXISTS disaster_reports_created_at_idx
  ON public.disaster_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS disaster_reports_dedupe_hash_idx
  ON public.disaster_reports (dedupe_hash);
CREATE INDEX IF NOT EXISTS disaster_reports_mint_status_idx
  ON public.disaster_reports (onchain_mint_status, created_at);
CREATE INDEX IF NOT EXISTS disaster_reports_reporter_user_id_idx
  ON public.disaster_reports (reporter_user_id);

-- ---------------------------------------------------------------------------
-- aeris_user_roles — RBAC for the dashboard
-- ---------------------------------------------------------------------------
-- OWNED BY AERIS CHAT, which creates it in
-- 20260521120000_add_ai_triage_and_user_roles.sql but never reads it. Mirrored
-- here (IF NOT EXISTS, so it is a no-op against the real database) because the
-- dashboard is its only consumer.
--
-- Reproduced as originally defined, including the auth.users foreign key.
-- 20260726130000 then converts user_id to text — see that migration and
-- docs/AUTH_ROLES.md for why.
CREATE TABLE IF NOT EXISTS public.aeris_user_roles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('volunteer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ---------------------------------------------------------------------------
-- report_review_events — moderation audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_review_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id                    uuid NOT NULL
                                 REFERENCES public.disaster_reports (id) ON DELETE CASCADE,
  actor_type                   text NOT NULL,
  actor_id                     text,
  action                       text NOT NULL,
  previous_verification_status text,
  new_verification_status      text,
  previous_moderation_status   text,
  new_moderation_status        text,
  confidence_before            numeric,
  confidence_after             numeric,
  note                         text,
  metadata                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_review_events_report_id_idx
  ON public.report_review_events (report_id, created_at DESC);

-- RLS: both tables are written only by server routes holding the service role.
ALTER TABLE public.aeris_user_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aeris_user_roles_service_all ON public.aeris_user_roles;
CREATE POLICY aeris_user_roles_service_all
  ON public.aeris_user_roles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS report_review_events_service_all ON public.report_review_events;
CREATE POLICY report_review_events_service_all
  ON public.report_review_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
