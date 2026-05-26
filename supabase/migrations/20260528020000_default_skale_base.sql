-- Phase 6.2 - Switch the disaster_reports on-chain default columns from
-- base-mainnet (8453) to skale-base-testnet (324705682). Existing rows are
-- left untouched so historical reports retain their original network values.
--
-- Production should set AERIS_ONCHAIN_NETWORK=skale-base-mainnet and override
-- via the mint worker; the column defaults are only used for new rows that
-- don't explicitly pass an onchain_network.

ALTER TABLE public.disaster_reports
  ALTER COLUMN onchain_network SET DEFAULT 'skale-base-testnet',
  ALTER COLUMN onchain_chain_id SET DEFAULT 324705682;
