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

**4. The table was built for Supabase Auth.** AERIS CHAT owns it
(`20260521120000_add_ai_triage_and_user_roles.sql`) and defines it as:

```sql
CREATE TABLE IF NOT EXISTS public.aeris_user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('volunteer', 'admin')),
  ...
);
CREATE POLICY aeris_user_roles_select_own ... USING (auth.uid() = user_id);
```

So this is not a stray type choice — the table predates the move to Privy and
was never migrated with it. A Privy DID is neither a uuid *nor* a row in
`auth.users`, so two separate constraints reject it.

Both the foreign key and the `aeris_user_roles_select_own` policy depend on
`user_id`, so a bare `ALTER COLUMN TYPE` fails with:

```
0A000: cannot alter type of a column used in a policy definition
DETAIL: policy aeris_user_roles_select_own on table aeris_user_roles depends on column "user_id"
```

(An earlier revision of this document claimed `user_id` had no foreign key.
That was wrong — it came from PostgREST's OpenAPI output, which annotates
foreign keys between exposed schemas but not references into `auth`.)

**5. It failed silently.** Both lookups discarded the error and returned
`guest_viewer`, making "lookup failed" indistinguishable from "user has no
role". Fixed: [`lib/aeris-role-lookup.ts`](../lib/aeris-role-lookup.ts) now logs
any non-2xx with the upstream body, and
[`lib/supabase-server.ts`](../lib/supabase-server.ts) delegates to it rather
than running a second, RLS-dependent query with the anon key.

## The fix

Given finding 3 there is no trade-off — align the column with the rest of the
schema. The policy and the foreign key must come off first, and the policy goes
back with a cast.

[`supabase/migrations/20260726130000_aeris_user_roles_text_user_id.sql`](../supabase/migrations/20260726130000_aeris_user_roles_text_user_id.sql)
does exactly this, in one transaction, discovering the FK's name rather than
assuming it. Run that file, then grant yourself admin:

```sql
insert into public.aeris_user_roles (user_id, role)
values ('did:privy:cmq8goey1001z0dl58zzj2ilc', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

Find any other DID with:

```sql
select user_id, username, email from public.aeris_user_profiles
where email = 'them@example.com';
```

`role` is constrained to `volunteer` / `admin`; the app maps anything else to
`guest_viewer` ([`lib/aeris-roles.ts`](../lib/aeris-roles.ts)).

### Is dropping the auth.users FK safe?

Yes, for this database. AERIS CHAT does use Supabase Auth (`signUp` /
`signInWithPassword`), so `auth.users` is live — but a repo-wide search shows it
**never reads `aeris_user_roles` in code**; it only created the table. The
`ON DELETE CASCADE` therefore protected nothing in use, while the constraint
actively blocked the table's only real consumer.

Re-check this if AERIS CHAT ever starts reading the table.

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
