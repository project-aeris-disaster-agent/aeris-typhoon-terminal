-- Phase 6.7 follow-up: read mint webhook config from Supabase Vault.
--
-- The original migration (20260528030000_mint_webhook_trigger.sql) used
-- `current_setting('app.mint_webhook_url', true)` to read the URL/secret,
-- which requires `ALTER DATABASE postgres SET ...`. That ALTER fails on
-- Supabase hosted projects with `42501: permission denied to set parameter`
-- because non-superusers can't mutate database-level GUCs.
--
-- This migration replaces the function body with a Vault-first lookup that
-- falls back to GUCs (in case a self-hosted Postgres or future Supabase
-- permission change allows them). Vault secrets are stored encrypted and
-- decrypted on demand via `vault.decrypted_secrets`.
--
-- One-time setup (run in SQL editor as the postgres role):
--   select vault.create_secret(
--     'https://<your-dashboard>.vercel.app/api/internal/onchain-mint',
--     'aeris_mint_webhook_url'
--   );
--   select vault.create_secret(
--     '<value of INTERNAL_TRIAGE_SECRET>',
--     'aeris_mint_webhook_secret'
--   );
--
-- To rotate later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'aeris_mint_webhook_secret'),
--     '<new secret>'
--   );
--
-- To disable temporarily (no need to drop the trigger):
--   delete from vault.secrets where name in
--     ('aeris_mint_webhook_url', 'aeris_mint_webhook_secret');
-- The function then no-ops because both v_url and v_secret resolve to null.

create extension if not exists supabase_vault with schema vault;

create or replace function public.aeris_notify_mint_queued()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Only fire on transitions INTO 'queued' from a different state.
  if new.onchain_mint_status is distinct from 'queued' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(old.onchain_mint_status, '') = 'queued' then
    return new;
  end if;

  -- 1. Prefer Vault (works on Supabase hosted; no GUC privilege required).
  begin
    select decrypted_secret
      into v_url
      from vault.decrypted_secrets
      where name = 'aeris_mint_webhook_url'
      limit 1;
  exception when others then
    v_url := null;
  end;
  begin
    select decrypted_secret
      into v_secret
      from vault.decrypted_secrets
      where name = 'aeris_mint_webhook_secret'
      limit 1;
  exception when others then
    v_secret := null;
  end;

  -- 2. Fall back to GUCs (legacy / self-hosted scenarios).
  if v_url is null or v_url = '' then
    begin
      v_url := current_setting('app.mint_webhook_url', true);
    exception when others then
      v_url := null;
    end;
  end if;
  if v_secret is null or v_secret = '' then
    begin
      v_secret := current_setting('app.mint_webhook_secret', true);
    exception when others then
      v_secret := null;
    end;
  end if;

  -- No config -> silently no-op so verify flows stay functional in any env.
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'reportId', new.id,
      'source', 'pg_net_trigger',
      'record', jsonb_build_object(
        'id', new.id,
        'onchain_mint_status', new.onchain_mint_status,
        'verification_status', new.verification_status,
        'phone_verification_status', new.phone_verification_status
      )
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

comment on function public.aeris_notify_mint_queued() is
  'Phase 6.7: POSTs to the Dashboard mint endpoint when a report becomes queued. Reads URL/secret from Supabase Vault (aeris_mint_webhook_url, aeris_mint_webhook_secret) with a GUC fallback. Safe no-op when unconfigured.';
