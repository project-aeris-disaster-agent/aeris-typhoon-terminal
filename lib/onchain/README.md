# On-chain mint pipeline (AERIS x SKALE-Base)

Path from "operator verifies a report" → "ERC-1155 minted on SKALE-Base".

```
operator verify in Dashboard
  └─ lib/supabase-reports.ts → reviewSupabaseReport()
       sets verification_status = 'verified'
       sets onchain_mint_status  = 'queued'   (iff phone is verified)

  ┌───────────────────────────────────────────────────────────┐
  │ PUSH PATH  (~1s end-to-end)                               │
  │                                                           │
  │  Postgres trigger (pg_net)                                │
  │   └─ POST  /api/internal/onchain-mint                     │
  │        body: { reportId, source: 'pg_net_trigger', ... }  │
  │        auth: Bearer ${INTERNAL_TRIAGE_SECRET}             │
  │                                                           │
  │  app/api/internal/onchain-mint/route.ts                   │
  │   └─ services/onchain-mint-worker.ts → mintReportById()   │
  │        ↳ pin Hypercert metadata to IPFS                   │
  │        ↳ mintReport() on AerisReports.sol                 │
  │        ↳ stamp tx hash + token id back to disaster_reports│
  └───────────────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────────────┐
  │ SAFETY-NET PATH  (daily cron; or 5-10 min on Pro)         │
  │                                                           │
  │  Vercel cron → GET /api/cron/onchain-mint                 │
  │   └─ mintStaleQueuedReports({ minAgeSeconds: 120 })       │
  │        ↳ only picks rows that have been queued > 120s,    │
  │          so it doesn't race the push path                 │
  └───────────────────────────────────────────────────────────┘
```

## Components

| File | Purpose |
|---|---|
| `contracts/src/AerisReports.sol` | ERC-1155 + AccessControl; `MINTER_ROLE` mints one token per verified report. |
| `lib/onchain/skale-base.ts` | Network constants for SKALE Base mainnet/testnet. |
| `lib/onchain/hypercert-metadata.ts` | Builds Hypercerts-shaped ERC-1155 metadata + maps report UUID → uint256 tokenId. |
| `lib/onchain/ipfs.ts` | Pinata client with a `dev-skip` fallback (no JWT required for testing). |
| `lib/onchain/mint-client.ts` | viem-based wrapper that talks to `AerisReports`. SKALE-correct (legacy tx, live `eth_gasPrice`). |
| `lib/onchain/mint-queue.ts` | Supabase helpers: list queued/stale rows, transition state, fetch by id. |
| `services/onchain-mint-worker.ts` | Orchestrates a mint: `mintReportById` (push), `mintQueuedReports` (manual drain), `mintStaleQueuedReports` (cron). |
| `app/api/internal/onchain-mint/route.ts` | Dual-purpose endpoint - accepts Supabase webhook payload (push) **and** manual batch invocations. |
| `app/api/cron/onchain-mint/route.ts` | Vercel cron handler; sweeps only rows older than `ONCHAIN_MINT_STALE_SECONDS`. |
| `scripts/deploy-aeris-reports.ts` | Foundry-free deploy via `solc` + `viem`. Run with `npm run deploy:contract`. |
| `scripts/mint-testnet.ts` | E2E smoke - inserts synthetic verified report, drains queue. Run with `npm run smoke:mint`. |
| `supabase/migrations/20260528020000_default_skale_base.sql` | Defaults `onchain_network` + `onchain_chain_id` to SKALE Base Sepolia. |
| `supabase/migrations/20260528030000_mint_webhook_trigger.sql` | `pg_net` trigger that POSTs to the push endpoint on `queued` transitions. |
| `supabase/migrations/20260528050000_mint_webhook_pgnet_timeout.sql` | Raises `pg_net` `timeout_milliseconds` to 60s (matches Vercel `maxDuration`). |

## Required env

```bash
# Active network and contract
AERIS_ONCHAIN_NETWORK=skale-base-testnet          # or skale-base-mainnet
AERIS_REPORTS_CONTRACT_ADDRESS=0xcebbe3255b6a948206bc7353967b13960af34ea8
AERIS_SERVICE_PRIVATE_KEY=<64 hex chars, with or without 0x>

# Endpoint auth (shared with triage)
INTERNAL_TRIAGE_SECRET=...
CRON_SECRET=...                                   # set by Vercel for cron auth

# Optional tuning
ONCHAIN_MINT_BATCH_LIMIT=10                       # default 5 for manual, 10 for cron
ONCHAIN_MINT_STALE_SECONDS=120                    # cron only picks rows older than this
PINATA_JWT=...                                    # optional, falls back to dev-skip
```

## Enabling the push path

Two migrations install + configure the trigger:

- `20260528030000_mint_webhook_trigger.sql` — creates the trigger and the function.
- `20260528040000_mint_webhook_vault_config.sql` — switches the function to read URL/secret from **Supabase Vault** (with a GUC fallback for self-hosted environments).

The trigger is **safe by default**: if the vault secrets are not set, it silently no-ops, so verifying a report never fails because of webhook config.

### Configure via Supabase Vault (recommended for hosted Supabase)

Run **once** in the Supabase SQL editor for the target environment:

```sql
select vault.create_secret(
  'https://<your-dashboard>.vercel.app/api/internal/onchain-mint',
  'aeris_mint_webhook_url',
  'AERIS mint webhook URL - Vercel internal endpoint'
);
select vault.create_secret(
  '<value of INTERNAL_TRIAGE_SECRET>',
  'aeris_mint_webhook_secret',
  'Bearer token matching INTERNAL_TRIAGE_SECRET'
);
```

> **Why Vault and not `ALTER DATABASE postgres SET ...`?** Hosted Supabase blocks
> non-superusers from mutating database GUCs (`42501: permission denied to set parameter`).
> Vault is the supported way to store and read encrypted config inside Postgres.

#### Rotate

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'aeris_mint_webhook_secret'),
  '<new secret>'
);
```

#### Verify

```sql
select name, length(decrypted_secret) as len
from   vault.decrypted_secrets
where  name in ('aeris_mint_webhook_url', 'aeris_mint_webhook_secret');
```

#### Smoke-test the push path

Pick any existing report id, force it to `queued`, and watch your Vercel function logs:

```sql
update public.disaster_reports
set    onchain_mint_status = 'queued'
where  id = '<verified-report-id>';
```

You should see `POST /api/internal/onchain-mint` arrive within ~1s with `{ mode: "push", target: ... }`, and the row will end up `minted` with a tx hash.

### Configure via GUCs (self-hosted Postgres only)

If you control the Postgres superuser (i.e. self-hosted Supabase or bare Postgres), GUCs still work as a fallback:

```sql
alter database postgres set app.mint_webhook_url =
  'https://<your-dashboard>.vercel.app/api/internal/onchain-mint';
alter database postgres set app.mint_webhook_secret =
  '<value of INTERNAL_TRIAGE_SECRE>';
```

### Disabling temporarily

```sql
delete from vault.secrets
where  name in ('aeris_mint_webhook_url', 'aeris_mint_webhook_secret');
```

The trigger then no-ops; the cron continues to sweep stale rows.

## Why a Database Webhook instead of Realtime client subscription

Supabase Realtime works over WebSockets and needs a long-lived process to subscribe. Vercel serverless functions can't host that. `pg_net` lets the database POST directly to our existing HTTP endpoint, which:

- runs natively on Vercel (no extra hosting),
- reuses the same `INTERNAL_TRIAGE_SECRET` boundary,
- delivers in ~1s,
- is fully version-controlled in `supabase/migrations/`.

If `pg_net` delivery ever fails (network blip, function cold-start error, contract revert), the cron sweep at `/api/cron/onchain-mint` will catch the row on its next run because the row stays `queued` until the worker successfully transitions it.

## Smoke test

```powershell
npm run smoke:mint
```

Inserts a synthetic verified report, drains the queue, and asserts the row reached `minted` with a tx hash. Prints the SKALE explorer URL.

## Deploy a new contract

```powershell
npm run deploy:contract
```

Compiles `contracts/src/AerisReports.sol` with `solc` (no Foundry needed) and deploys via viem using the SKALE-correct legacy-tx + live-gasPrice pattern. Prints the new address; paste it into `.env`.
