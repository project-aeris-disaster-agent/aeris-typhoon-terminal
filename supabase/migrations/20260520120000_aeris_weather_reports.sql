-- National weather reports and public Agent AERIS broadcast feed.

CREATE TABLE IF NOT EXISTS public.aeris_weather_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'breaking')),
  scope_type TEXT NOT NULL DEFAULT 'national',
  scope_key TEXT NOT NULL DEFAULT 'PH',
  severity_score INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  structured JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB NOT NULL,
  trigger_reason TEXT NOT NULL,
  alert_signature TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.aeris_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  source TEXT NOT NULL DEFAULT 'assistant'
    CHECK (source IN ('user', 'assistant', 'system', 'weather_report')),
  content TEXT NOT NULL,
  report_id UUID REFERENCES public.aeris_weather_reports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_aeris_weather_reports_created
  ON public.aeris_weather_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aeris_weather_reports_type_created
  ON public.aeris_weather_reports (report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aeris_weather_reports_scope_created
  ON public.aeris_weather_reports (scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aeris_agent_messages_created
  ON public.aeris_agent_messages (created_at DESC);

ALTER TABLE public.aeris_weather_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aeris_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read national weather reports"
  ON public.aeris_weather_reports
  FOR SELECT
  USING (true);

CREATE POLICY "Public read agent broadcast messages"
  ON public.aeris_agent_messages
  FOR SELECT
  USING (source IN ('assistant', 'system', 'weather_report'));
