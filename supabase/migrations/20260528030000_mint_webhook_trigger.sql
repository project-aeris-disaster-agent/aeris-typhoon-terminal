-- Phase 6.7: Push-based mint trigger.
--
-- When a disaster_reports row transitions to onchain_mint_status='queued',
-- POST { reportId } to the Dashboard's internal mint endpoint so the worker
-- can mint immediately. The Vercel cron at /api/cron/onchain-mint remains
-- as a safety-net sweep for any rows the push path misses.
--
-- Configure two GUCs (set via Supabase Studio -> Database -> Settings or via
-- `ALTER DATABASE postgres SET ...`):
--
--   ALTER DATABASE postgres SET app.mint_webhook_url =
--     'https://your-dashboard.vercel.app/api/internal/onchain-mint';
--   ALTER DATABASE postgres SET app.mint_webhook_secret = 'YOUR_INTERNAL_TRIAGE_SECRET';
--
-- If either GUC is unset (e.g. local dev), the trigger no-ops gracefully so
-- the verify flow itself never fails because of a missing webhook config.

create extension if not exists pg_net with schema extensions;

create or replace function public.aeris_notify_mint_queued()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Only fire when transitioning into 'queued' from a different state.
  if new.onchain_mint_status is distinct from 'queued' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(old.onchain_mint_status, '') = 'queued' then
    return new;
  end if;

  begin
    v_url := current_setting('app.mint_webhook_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_secret := current_setting('app.mint_webhook_secret', true);
  exception when others then
    v_secret := null;
  end;

  -- No config -> silently no-op so local/dev environments stay functional.
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

drop trigger if exists aeris_mint_queued_webhook on public.disaster_reports;
create trigger aeris_mint_queued_webhook
after insert or update of onchain_mint_status on public.disaster_reports
for each row
execute function public.aeris_notify_mint_queued();

comment on function public.aeris_notify_mint_queued() is
  'Phase 6.7: POSTs to the Dashboard mint endpoint when a report becomes queued for on-chain mint. Configure via app.mint_webhook_url and app.mint_webhook_secret GUCs. Safe no-op when unset.';
