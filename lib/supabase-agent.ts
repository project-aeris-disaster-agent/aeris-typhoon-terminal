import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";
import type { ComposedWeatherReport } from "@/services/weather-report-compose";

export type WeatherReportRow = {
  id: string;
  report_type: WeatherReportType;
  scope_type: string;
  scope_key: string;
  severity_score: number;
  headline: string;
  body: string;
  structured: Record<string, unknown>;
  snapshot: NationalWeatherSnapshot;
  trigger_reason: string;
  alert_signature: string;
  created_at: string;
};

export type AgentMessageSource =
  | "user"
  | "assistant"
  | "system"
  | "weather_report"
  | "operator";

export type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  source: AgentMessageSource;
  content: string;
  report_id: string | null;
  disaster_report_id: string | null;
  session_id: string | null;
  operator_name: string | null;
  responded_to_id: string | null;
  created_at: string;
};

export type PersistedWeatherReport = {
  id: string;
  reportType: WeatherReportType;
  severityScore: number;
  headline: string;
  body: string;
  triggerReason: string;
  alertSignature: string;
  createdAt: string;
};

const REPORT_COLUMNS =
  "id,report_type,scope_type,scope_key,severity_score,headline,body,structured,snapshot,trigger_reason,alert_signature,created_at";

const MESSAGE_COLUMNS =
  "id,role,source,content,report_id,disaster_report_id,session_id,operator_name,responded_to_id,created_at";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || (!serviceKey && !anonKey)) return null;
  return {
    url: url.replace(/\/$/, ""),
    serviceKey,
    anonKey,
  };
}

export function supabaseAgentEnabled(): boolean {
  return supabaseConfig() !== null;
}

function authHeaders(key: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

function toPersisted(row: WeatherReportRow): PersistedWeatherReport {
  return {
    id: row.id,
    reportType: row.report_type,
    severityScore: row.severity_score,
    headline: row.headline,
    body: row.body,
    triggerReason: row.trigger_reason,
    alertSignature: row.alert_signature,
    createdAt: row.created_at,
  };
}

export async function listAgentMessages(limit = 50): Promise<AgentMessageRow[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];

  const key = cfg.anonKey ?? cfg.serviceKey;
  if (!key) return [];

  const url = new URL(`${cfg.url}/rest/v1/aeris_agent_messages`);
  url.searchParams.set(
    "select",
    MESSAGE_COLUMNS,
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(Math.min(limit, 100)));

  const res = await fetch(url.toString(), {
    headers: authHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) return [];

  const rows = (await res.json()) as AgentMessageRow[];
  return rows.reverse();
}

export async function listWeatherReports(limit = 20): Promise<PersistedWeatherReport[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];

  const key = cfg.anonKey ?? cfg.serviceKey;
  if (!key) return [];

  const url = new URL(`${cfg.url}/rest/v1/aeris_weather_reports`);
  url.searchParams.set("select", REPORT_COLUMNS);
  url.searchParams.set("scope_key", "eq.PH");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(Math.min(limit, 50)));

  const res = await fetch(url.toString(), {
    headers: authHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) return [];

  const rows = (await res.json()) as WeatherReportRow[];
  return rows.map(toPersisted);
}

export async function getLatestNationalReport(
  reportType?: WeatherReportType,
): Promise<PersistedWeatherReport | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const key = cfg.anonKey ?? cfg.serviceKey;
  if (!key) return null;

  const url = new URL(`${cfg.url}/rest/v1/aeris_weather_reports`);
  url.searchParams.set("select", REPORT_COLUMNS);
  url.searchParams.set("scope_key", "eq.PH");
  if (reportType) url.searchParams.set("report_type", `eq.${reportType}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: authHeaders(key),
    cache: "no-store",
  });

  if (!res.ok) return null;

  const rows = (await res.json()) as WeatherReportRow[];
  return rows[0] ? toPersisted(rows[0]) : null;
}

export async function persistWeatherReportBundle(args: {
  snapshot: NationalWeatherSnapshot;
  reportType: WeatherReportType;
  triggerReason: string;
  composed: ComposedWeatherReport;
  agentMessage: string;
}): Promise<{ report: PersistedWeatherReport; message: AgentMessageRow }> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to persist weather reports.");
  }

  const reportPayload = {
    report_type: args.reportType,
    scope_type: "national",
    scope_key: "PH",
    severity_score: args.snapshot.severityScore,
    headline: args.composed.headline,
    body: args.composed.body,
    structured: args.composed.structured,
    snapshot: args.snapshot,
    trigger_reason: args.triggerReason,
    alert_signature: args.snapshot.alertSignature,
  };

  const reportRes = await fetch(
    `${cfg.url}/rest/v1/aeris_weather_reports?select=${REPORT_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(reportPayload),
    },
  );

  if (!reportRes.ok) {
    const detail = await reportRes.text();
    throw new Error(`Supabase weather report insert ${reportRes.status}: ${detail}`);
  }

  const reportRows = (await reportRes.json()) as WeatherReportRow[];
  const reportRow = reportRows[0];
  if (!reportRow) throw new Error("Supabase returned no weather report row.");

  const messageRes = await fetch(
    `${cfg.url}/rest/v1/aeris_agent_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify({
        role: "assistant",
        source: "weather_report",
        content: args.agentMessage,
        report_id: reportRow.id,
      }),
    },
  );

  if (!messageRes.ok) {
    const detail = await messageRes.text();
    throw new Error(`Supabase agent message insert ${messageRes.status}: ${detail}`);
  }

  const messageRows = (await messageRes.json()) as AgentMessageRow[];
  const messageRow = messageRows[0];
  if (!messageRow) throw new Error("Supabase returned no agent message row.");

  return { report: toPersisted(reportRow), message: messageRow };
}

export async function insertUserAgentMessage(content: string): Promise<AgentMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_agent_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify({
        role: "user",
        source: "user",
        content,
      }),
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as AgentMessageRow[];
  return rows[0] ?? null;
}

export type UrgentBroadcastContext = {
  disasterReportId?: string;
  sessionId?: string;
};

export async function insertUrgentReportAgentMessage(
  content: string,
  context: UrgentBroadcastContext = {},
): Promise<AgentMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const payload: Record<string, unknown> = {
    role: "system",
    source: "system",
    content,
  };
  if (context.disasterReportId) {
    payload.disaster_report_id = context.disasterReportId;
  }
  if (context.sessionId) {
    payload.session_id = context.sessionId;
  }

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_agent_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as AgentMessageRow[];
  return rows[0] ?? null;
}

export type OperatorReplyContext = {
  disasterReportId?: string;
  sessionId?: string;
  operatorName?: string;
  respondedToId?: string;
};

export async function insertOperatorReplyAgentMessage(
  content: string,
  context: OperatorReplyContext = {},
): Promise<AgentMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const payload: Record<string, unknown> = {
    role: "assistant",
    source: "operator",
    content,
  };
  if (context.disasterReportId) {
    payload.disaster_report_id = context.disasterReportId;
  }
  if (context.sessionId) {
    payload.session_id = context.sessionId;
  }
  if (context.operatorName) {
    payload.operator_name = context.operatorName;
  }
  if (context.respondedToId) {
    payload.responded_to_id = context.respondedToId;
  }

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_agent_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as AgentMessageRow[];
  return rows[0] ?? null;
}

export async function getLatestUrgentMessageForSession(
  sessionId: string,
): Promise<AgentMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const url = new URL(`${cfg.url}/rest/v1/aeris_agent_messages`);
  url.searchParams.set("select", MESSAGE_COLUMNS);
  url.searchParams.set("session_id", `eq.${sessionId}`);
  url.searchParams.set("source", "eq.system");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: authHeaders(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const rows = (await res.json()) as AgentMessageRow[];
  return rows[0] ?? null;
}

export async function insertAssistantAgentMessage(
  content: string,
): Promise<AgentMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_agent_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify({
        role: "assistant",
        source: "assistant",
        content,
      }),
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as AgentMessageRow[];
  return rows[0] ?? null;
}
