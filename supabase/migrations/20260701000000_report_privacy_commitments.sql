-- Phase 7 - Privacy-minimizing commitments for on-chain report metadata.
--
-- The mint pipeline no longer puts exact GPS, free-text description, or an
-- evidence photo directly into public, immutable token metadata (see
-- lib/onchain/commitments.ts and lib/onchain/hypercert-metadata.ts). Instead
-- it mints salted SHA-256 commitments of those values; the salt and exact
-- values stay here in Supabase, revealable only through an authorized
-- channel. Deleting a row (or nulling geo_salt) on an erasure request makes
-- the on-chain commitment practically unopenable even though the hash bytes
-- remain on-chain forever - a cryptographic "right to be forgotten", not
-- literal deletion.
--
-- Populated server-side at mint time only (services/onchain-mint-worker.ts);
-- never client-supplied, never exposed via the public reports API.

ALTER TABLE public.disaster_reports
  ADD COLUMN IF NOT EXISTS geo_salt TEXT,
  ADD COLUMN IF NOT EXISTS geo_commitment TEXT,
  ADD COLUMN IF NOT EXISTS description_commitment TEXT,
  ADD COLUMN IF NOT EXISTS photo_commitment TEXT;

COMMENT ON COLUMN public.disaster_reports.geo_salt IS
  'Server-generated salt used to derive geo_commitment/description_commitment/photo_commitment. Never minted, never public.';
COMMENT ON COLUMN public.disaster_reports.geo_commitment IS
  'sha256(exact lng|exact lat|geo_salt), minted on-chain in place of raw coordinates.';
COMMENT ON COLUMN public.disaster_reports.description_commitment IS
  'sha256(description|geo_salt), minted on-chain in place of the raw free-text description.';
COMMENT ON COLUMN public.disaster_reports.photo_commitment IS
  'sha256(sha256(evidence photo bytes)|geo_salt), minted on-chain when the report has an approved evidence photo. Null otherwise.';
