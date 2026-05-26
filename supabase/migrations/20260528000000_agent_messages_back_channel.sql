-- Phase 4.3: Dashboard -> Chat back-channel.
--
-- aeris_agent_messages previously only referenced aeris_weather_reports via
-- report_id. Urgent incident broadcasts now also need to remember which
-- disaster_reports row they originated from, and which chat session the
-- end-user is on so the operator's reply can be posted back into the chat.

ALTER TABLE public.aeris_agent_messages
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS disaster_report_id uuid,
  ADD COLUMN IF NOT EXISTS operator_name text,
  ADD COLUMN IF NOT EXISTS responded_to_id uuid REFERENCES public.aeris_agent_messages(id);

-- Allow the 'operator' source so we can distinguish manual operator replies
-- from generic assistant messages.
ALTER TABLE public.aeris_agent_messages
  DROP CONSTRAINT IF EXISTS aeris_agent_messages_source_check;

ALTER TABLE public.aeris_agent_messages
  ADD CONSTRAINT aeris_agent_messages_source_check
  CHECK (source IN ('user', 'assistant', 'system', 'weather_report', 'operator'));

CREATE INDEX IF NOT EXISTS idx_aeris_agent_messages_disaster_report
  ON public.aeris_agent_messages (disaster_report_id, created_at DESC)
  WHERE disaster_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aeris_agent_messages_session
  ON public.aeris_agent_messages (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;
