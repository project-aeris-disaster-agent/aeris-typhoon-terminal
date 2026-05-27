-- Raise pg_net HTTP timeout for mint push trigger.
--
-- Minting on Vercel (cold start + IPFS + SKALE tx) often exceeds 5s.
-- pg_net was logging timeouts in net._http_response even when the mint
-- succeeded. 60s aligns with maxDuration on /api/internal/onchain-mint.

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
  if new.onchain_mint_status is distinct from 'queued' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(old.onchain_mint_status, '') = 'queued' then
    return new;
  end if;

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
    timeout_milliseconds := 60000
  );

  return new;
end;
$$;

comment on function public.aeris_notify_mint_queued() is
  'Phase 6.7: POSTs to the Dashboard mint endpoint when a report becomes queued. Vault config + 60s pg_net timeout (matches Vercel maxDuration).';
