# User Profiles & Gamification (shared contract)

This document is the source of truth for the cross-product user profile + XP
system. The **AERIS Dashboard/Terminal** and **AERIS CHAT** are separate apps
that share one Supabase project and one Privy app, so a user's profile, proxy
wallet, XP, and level are identical in both products. AERIS CHAT should adopt
the schema and rules below rather than re-implementing them.

## Identity model

- **Auth layer:** Privy (same `NEXT_PUBLIC_PRIVY_APP_ID` across products).
- **Primary key:** the Privy DID (e.g. `did:privy:...`), stored as `TEXT`.
- **Email:** taken from the linked Google/email account when present, else `null`
  (wallet-only logins).
- **Proxy wallet:** the user's Privy **embedded** Ethereum wallet address,
  treated as their SKALE-Base proxy wallet (`wallet_chain = 'skale-base'`). It is
  read authoritatively from Privy server-side at sync time.
- **Reports carry the DID:** `disaster_reports.reporter_user_id` (TEXT) stores the
  reporter's Privy DID when signed in (null for anonymous). The legacy
  `disaster_reports.user_id` is UUID and cannot hold a DID; both apps should write
  `reporter_user_id`. This is what enables the `report_verified` award to the
  original author.

## Database schema

Migration: `supabase/migrations/20260618100000_user_profiles_gamification.sql`
(applied to the shared Supabase project, so both apps see it immediately).

### `aeris_user_profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `TEXT` PK | Privy DID |
| `email` | `TEXT` | nullable |
| `username` | `TEXT` NOT NULL | unique on `lower(username)`; random default |
| `proxy_wallet_address` | `TEXT` | Privy embedded wallet |
| `wallet_chain` | `TEXT` | default `skale-base` |
| `barangay` | `TEXT` | user-editable |
| `phone` | `TEXT` | user-editable |
| `socials` | `JSONB` | `{ twitter, facebook, instagram, telegram, discord, website }` |
| `avatar_url` | `TEXT` | user-editable |
| `xp` | `INT` | default 0 |
| `level` | `INT` | default 0, derived from `xp` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

### `aeris_xp_events` (ledger + idempotency)

`id`, `user_id`, `action`, `points`, `ref_id`, `dedupe_key` (unique when set),
`created_at`. A non-null `dedupe_key` guarantees an action is rewarded only once.

### RLS

Both base tables are **service-role only** (they hold PII). Apps must read/write
through their own API routes using the service role. A column-restricted
`aeris_leaderboard` view (`user_id, username, level, xp`) is granted to
`anon, authenticated` for safe client-side leaderboards.

## Level curve (0 → 99)

Cumulative XP required to reach level `L` is `25 * L * (L + 1)`:

- Lv 1 = 50, Lv 2 = 150, Lv 10 = 2,750, Lv 50 = 63,750, Lv 99 = 247,500.

The curve lives in two mirrored places that MUST stay in sync:

- SQL: `aeris_level_from_xp(xp)`
- TS: `levelFromXp(xp)` / `levelProgress(xp)` in `lib/gamification.ts`

## XP actions (defaults)

Defined in `lib/gamification.ts` (`XP_REWARDS`):

| Action | Points | Awarded when | dedupe_key |
| --- | --- | --- | --- |
| `submit_report` | 15 | a signed-in user files a report | `submit_report:{reportId}` |
| `report_verified` | 40 | the reporter's report is verified | `report_verified:{reportId}` |
| `review_report` | 10 | a human operator verifies a report | `review_report:{reportId}` |
| `usage_time` | 5 | per 15-min bucket of active dashboard time | `usage:{userId}:{bucket}` |
| `profile_completed` | 25 | barangay + phone + ≥1 social filled in | `profile_completed:{userId}` |

### Awarding XP

Server-side, call `award_xp` via the helper:

```ts
import { awardXp } from "@/lib/gamification";

await awardXp(userId, "review_report", {
  refId: reportId,
  dedupeKey: `review_report:${reportId}`,
});
```

Or the PostgREST RPC directly (service role):

```
POST {SUPABASE_URL}/rest/v1/rpc/award_xp
{ "p_user_id", "p_action", "p_points", "p_dedupe_key", "p_ref_id" }
-> [{ "xp", "level", "leveled_up", "awarded" }]
```

`awarded` is `false` when the `dedupe_key` already existed (no double-award) or
when the profile row does not exist yet.

## API surface (dashboard)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/user/sync` | POST | create/refresh profile from Privy (email + wallet) |
| `/api/user/profile` | GET | full profile for the session user |
| `/api/user/profile` | PATCH | edit `username`, `barangay`, `phone`, `socials`, `avatar_url` |
| `/api/user/activity` | POST | usage-time heartbeat (awards `usage_time`) |

Username validation (shared with community chat nicks): 3–24 chars, pattern
`^[A-Za-z0-9_\-.[\]]+$`, case-insensitive unique.

## Sync flow

```
Privy login (onComplete)  ─┐
ProfileProvider on load   ─┴─> POST /api/user/sync
        -> verify Privy token -> userId
        -> Privy REST GET /v1/users/{did}  (email + embedded wallet)
        -> ensureUserProfile() upsert (random username on first insert)
```

The client `ProfileProvider` (`services/profile-context.tsx`) exposes
`{ profile, loading, refresh, updateProfile }` and runs the usage heartbeat.

## Adopting in AERIS CHAT

1. No migration needed — the shared Supabase project already has the tables.
2. Reuse the same Privy DID as `user_id`.
3. Read/write profiles via service-role routes mirroring `lib/user-profiles.ts`.
4. Award XP via the `award_xp` RPC with stable `dedupe_key`s so the same action
   isn't rewarded twice across products (e.g. chat-side report submission should
   use the same `submit_report:{reportId}` key).
5. Render level/XP from `levelProgress(xp)` so the curve matches exactly.
