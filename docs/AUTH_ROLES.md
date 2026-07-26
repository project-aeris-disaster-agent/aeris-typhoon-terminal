# Auth roles — current defect and the decision to make

## Symptom

No user can hold the `admin` role in production. That disables:

| Surface | Gate |
| --- | --- |
| Report review / verify / reject | [`lib/review-auth.ts`](../lib/review-auth.ts) — `session.role !== "admin"` → 403 |
| Review controls in the reports panel | [`components/panels/LiveReportsPanel.tsx`](../components/panels/LiveReportsPanel.tsx) — `canReview` |
| Mobile dashboard access | [`middleware.ts`](../middleware.ts) + [`components/MobileAccessGate.tsx`](../components/MobileAccessGate.tsx) — non-admin phones are redirected to bagyo.app |
| Admin badge in header / chat | `components/Header.tsx`, `components/panels/CommunityChatRoom.tsx` |

## Root cause

Two independent problems stack:

1. **Type mismatch.** `aeris_user_roles.user_id` is `uuid`. The app authenticates
   with Privy, whose user ids are DIDs (`did:privy:cm...`). Filtering a `uuid`
   column by a DID makes PostgREST return `400 / 22P02 invalid input syntax for
   type uuid`. The lookup fails closed to `guest_viewer`.

   Note that `aeris_user_profiles.user_id` and `disaster_reports.reporter_user_id`
   are both `text` and *do* hold Privy DIDs — `aeris_user_roles` is the odd one out.

2. **The table is empty.** Zero rows, so even a Supabase-uuid session resolves to
   `guest_viewer`.

It failed silently because both lookups discarded the error and returned
`guest_viewer`, which is indistinguishable from "this user has no role". That
has been fixed — [`lib/aeris-role-lookup.ts`](../lib/aeris-role-lookup.ts) now
logs any non-2xx with the upstream body, and
[`lib/supabase-server.ts`](../lib/supabase-server.ts) delegates to it instead of
running a second, RLS-dependent query with the anon key.

## The decision

**Option A — change the column to `text` (recommended).**
Matches `aeris_user_profiles.user_id` and `disaster_reports.reporter_user_id`,
which already store Privy DIDs. One identity format across the schema.

```sql
alter table public.aeris_user_roles
  alter column user_id type text using user_id::text;

insert into public.aeris_user_roles (user_id, role)
values ('did:privy:REPLACE_WITH_REAL_DID', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

**Option B — keep `uuid` and map Privy DIDs to Supabase uuids.**
Requires a join table and a lookup on every request. Only worth it if something
outside this app requires `aeris_user_roles.user_id` to be a real `auth.users`
foreign key. Nothing in this repo does.

Take Option A unless AERIS CHAT depends on the `uuid` type — check before
applying, since the database is shared.

## After applying

1. Sign in and read your DID from `/api/auth/role` (it returns `userId`).
2. Insert the admin row with that DID.
3. Confirm `/api/auth/role` reports `"role": "admin"`.
4. Confirm report review returns 200 rather than 403.

Until step 2 is done for at least one account, report moderation stays offline.
