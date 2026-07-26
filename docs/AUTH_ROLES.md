# Auth roles — diagnosis and fix

## Symptom

No user can hold the `admin` role. That disables:

| Surface | Gate |
| --- | --- |
| Report review / verify / reject | [`lib/review-auth.ts`](../lib/review-auth.ts) — `session.role !== "admin"` → 403 |
| Review controls in the reports panel | [`components/panels/LiveReportsPanel.tsx`](../components/panels/LiveReportsPanel.tsx) — `canReview` |
| Mobile dashboard access | [`middleware.ts`](../middleware.ts) + [`components/MobileAccessGate.tsx`](../components/MobileAccessGate.tsx) — non-admin phones go to bagyo.app |
| Admin badge in header / chat | `components/Header.tsx`, `components/panels/CommunityChatRoom.tsx` |

## Diagnosis (verified against production, not inferred)

**1. `aeris_user_roles.user_id` is `uuid`; every real user id is a Privy DID.**

```
GET /rest/v1/aeris_user_roles?user_id=eq.did:privy:cm...
400  {"code":"22P02","message":"invalid input syntax for type uuid: \"did:privy:...\""}
```

Reads *and* writes fail the same way — a DID cannot be stored in this table at
all, so the role system has never been usable with Privy auth.

**2. The table is empty.** `GET /rest/v1/aeris_user_roles?select=*` → `[]`.
Even a uuid-shaped session would resolve to `guest_viewer`.

**3. There is no uuid user population to preserve.** Of 89 rows in
`aeris_user_profiles`:

| id format | count |
| --- | --- |
| `did:privy:*` | 88 |
| uuid | 1 — `00000000-0000-4000-8000-000000000d3b`, the `DEV_USER_ID` constant |

`aeris_user_profiles.user_id` and `disaster_reports.reporter_user_id` are both
`text` and already hold DIDs. `aeris_user_roles` is the only table that
disagrees.

**4. `user_id` has no foreign key** — it is a bare `uuid` primary key, so
changing its type does not cascade. (`role` does carry a check constraint,
`aeris_user_roles_role_check`; it is on a different column and is unaffected.)

**5. It failed silently.** Both lookups discarded the error and returned
`guest_viewer`, making "lookup failed" indistinguishable from "user has no
role". Fixed: [`lib/aeris-role-lookup.ts`](../lib/aeris-role-lookup.ts) now logs
any non-2xx with the upstream body, and
[`lib/supabase-server.ts`](../lib/supabase-server.ts) delegates to it rather
than running a second, RLS-dependent query with the anon key.

## The fix

Given finding 3, there is no real trade-off — align the column with the rest of
the schema. Run in the Supabase SQL editor:

```sql
-- 1. Match aeris_user_profiles.user_id / disaster_reports.reporter_user_id.
alter table public.aeris_user_roles
  alter column user_id type text using user_id::text;

-- 2. Grant admin to the operator account (Sedano, sedano@newprontera.com).
insert into public.aeris_user_roles (user_id, role)
values ('did:privy:cmq8goey1001z0dl58zzj2ilc', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

Find any other DID with:

```sql
select user_id, username, email from public.aeris_user_profiles
where email = 'them@example.com';
```

Allowed `role` values are constrained by `aeris_user_roles_role_check`; the app
understands `admin` and `volunteer` ([`lib/aeris-roles.ts`](../lib/aeris-roles.ts)),
and anything else resolves to `guest_viewer`.

⚠️ This database is shared with AERIS CHAT (`disaster_reports` carries foreign
keys into `chat_sessions` and `messages`). Nothing in *this* repo requires
`user_id` to be a uuid, but confirm AERIS CHAT does not read this table before
altering it.

## Verify

1. Sign in, then `GET /api/auth/role` — it returns your `userId`.
2. Confirm the response reports `"role": "admin"`.
3. Confirm report review returns 200 rather than 403.
4. Confirm no `[aeris-roles] Role lookup failed` lines remain in the logs.

## Follow-up: per-request role lookups in middleware

`blockMobileNonAdminApi` calls `lookupAerisRoleByUserId` on **every mobile API
request**. Today that is a fast 400; once the type is fixed it becomes a real
Supabase round-trip from the Edge runtime on each request. Before rolling this
out to mobile traffic, cache the result (short-TTL KV keyed by user id, or fold
the role into a signed cookie at login).
