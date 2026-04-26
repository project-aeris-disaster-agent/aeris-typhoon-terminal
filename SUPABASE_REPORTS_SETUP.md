# Shared AERIS Reports Setup

The dashboard and AERIS Chat now share a Supabase-backed report intake table.

## Apply The Migration

Run these SQL files in the Supabase SQL Editor for the shared project, or apply
them through the Supabase MCP:

`AERIS CHAT/06 AERIS CHAT/supabase/migrations/20260424194500_create_disaster_reports.sql`

`AERIS CHAT/06 AERIS CHAT/supabase/migrations/20260424203500_allow_public_visible_report_reads.sql`

`AERIS CHAT/06 AERIS CHAT/supabase/migrations/20260424215500_add_report_review_workflow.sql`

The migrations create `public.disaster_reports`, indexes, RLS policies, the
`updated_at` trigger, public read access for visible non-rejected reports, and
`public.report_review_events` for append-only human/AI review decisions.

## Required Environment Variables

Set these in both apps:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

AERIS Chat also needs:

```bash
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` must decode to JWT role `service_role` for report
inserts. The dashboard can read visible reports with the anon key because of
the public read policy, but dashboard-originated report submissions will fall
back to local KV if the service-role key is not present.

The operator review API also requires a real service-role key. This keeps
verification actions server-side and composable for future AI agents.

## Review Workflow

Reports are raw claims. Review decisions are stored separately as event history:

- `disaster_reports.verification_status`: current state shown on the dashboard.
- `disaster_reports.moderation_status`: visibility state.
- `report_review_events`: append-only audit trail for `human_operator`,
  `ai_agent`, and `system` actors.

Supported review actions:

```text
verify
reject
duplicate
hide
unhide
needs_review
unverify
note
confidence_adjust
```

## Verify The Data Plane

From the dashboard root:

```bash
npm run smoke:reports
```

Expected result after migration:

```text
reports_read_ok count=0
```

To insert a hidden smoke-test report:

```bash
npm run smoke:reports:insert
```

Smoke-test inserts use `moderation_status = "hidden"` so they should not appear
in the live dashboard feed.

## MCP Note

The Supabase MCP server must be authenticated with a Supabase access token before
it can apply migrations. If MCP returns `Unauthorized`, configure
`SUPABASE_ACCESS_TOKEN` or complete Supabase MCP OAuth, then apply the same SQL
migration through the MCP `apply_migration` tool.
