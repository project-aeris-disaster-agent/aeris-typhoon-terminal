import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isSpam, sanitizeText } from "@/lib/sanitize";
import {
  insertAssistantAgentMessage,
  insertUserAgentMessage,
} from "@/lib/supabase-agent";
import {
  buildAgentLiveContext,
  type AgentSelectedLocationHint,
} from "@/lib/agent-context";
import { AGENT_AERIS_PERSONA } from "@/lib/agent-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined;
}

function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if (
        (role !== "user" && role !== "assistant" && role !== "system") ||
        typeof content !== "string"
      ) {
        return null;
      }

      return {
        role,
        content: sanitizeText(content, 1600),
      };
    })
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-12);
}

function extractAssistantText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";

  const record = data as Record<string, unknown>;
  const candidate =
    record.message ?? record.content ?? record.response ?? record.text;
  return typeof candidate === "string" ? candidate : "";
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function normalizeLocationHint(value: unknown): AgentSelectedLocationHint | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : undefined;
  if (!name) return null;
  return {
    name,
    breadcrumb: typeof r.breadcrumb === "string" ? r.breadcrumb : undefined,
    type: typeof r.type === "string" ? r.type : undefined,
    psgcCode: typeof r.psgcCode === "string" ? r.psgcCode : undefined,
    lat: typeof r.lat === "number" ? r.lat : undefined,
    lon: typeof r.lon === "number" ? r.lon : undefined,
    population: typeof r.population === "number" ? r.population : undefined,
  };
}

export async function POST(request: Request) {
  const limit = await rateLimit({
    key: `agent-aeris:${getClientIp(request)}`,
    max: 30,
    windowSeconds: 60,
  });

  if (!limit.allowed) {
    return jsonError("Too many AGENT AERIS requests. Try again shortly.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const messages = normalizeMessages(record.messages);
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");

  if (!latestUserMessage) {
    return jsonError("At least one user message is required.", 400);
  }

  if (isSpam(latestUserMessage.content)) {
    return jsonError("Message rejected by content filter.", 400);
  }

  const baseUrl = process.env.AERIS_CHAT_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.AERIS_CHAT_API_KEY || process.env.LLM_API_KEY;

  if (!baseUrl) {
    return jsonError("AERIS_CHAT_API_BASE_URL is not configured.", 500);
  }

  if (!apiKey) {
    console.warn(
      "[agent-aeris] AERIS_CHAT_API_BASE_URL is set but neither AERIS_CHAT_API_KEY nor LLM_API_KEY is configured. Requests will fail if AERIS CHAT has LLM_API_KEY set (it should).",
    );
  }

  // Client-supplied stable ids (UUID) for optimistic-UI reconciliation.
  const clientUserMessageId = asUuid(record.clientUserMessageId);
  const clientAssistantMessageId = asUuid(record.clientAssistantMessageId);

  const locationHint = normalizeLocationHint(
    (record.context as Record<string, unknown> | undefined)?.selectedLocation ??
      record.selectedLocation,
  );

  const liveContext = await buildAgentLiveContext(locationHint).catch(() => null);

  const personaMessage: ChatMessage = {
    role: "system",
    content: AGENT_AERIS_PERSONA,
  };

  // Live context allowed a wider budget than user turns since it's structured
  // JSON, not free text. Capped to keep total prompt manageable.
  const liveContextMessage: ChatMessage = {
    role: "system",
    content: sanitizeText(
      `LIVE_CONTEXT (JSON, current as of ${liveContext?.generatedAt ?? "n/a"}):\n${compactJson(
        liveContext ?? { error: "live context unavailable" },
      )}\n\nREMINDER: national.verdictLabel is an AERIS composite, not a PAGASA wind signal. When you state the risk level, append the drivers from national.verdictReasons.`,
      8000,
    ),
  };

  const proxyTimeoutMs = Number(process.env.AGENT_CHAT_TIMEOUT_MS ?? "60000");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.isFinite(proxyTimeoutMs) && proxyTimeoutMs > 0 ? proxyTimeoutMs : 60_000,
  );

  try {
    const response = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        messages: [personaMessage, liveContextMessage, ...messages].map(
          (message) => ({
            role: message.role,
            content: message.content,
          }),
        ),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      return jsonError(
        extractAssistantText(data) ||
          "AERIS CHAT backend returned an error.",
        response.status,
      );
    }

    const assistantText =
      extractAssistantText(data) ||
      "AGENT AERIS received an empty response from the backend.";

    // Await both writes so the client can safely refetch history without
    // a race against unfinished inserts.
    const [userRow, assistantRow] = await Promise.all([
      insertUserAgentMessage(latestUserMessage.content, {
        id: clientUserMessageId,
      }),
      insertAssistantAgentMessage(assistantText, {
        id: clientAssistantMessageId,
      }),
    ]);

    return jsonOkNoStore({
      message: assistantText,
      userMessageId: userRow?.id ?? clientUserMessageId ?? null,
      assistantMessageId: assistantRow?.id ?? clientAssistantMessageId ?? null,
      contextGeneratedAt: liveContext?.generatedAt ?? null,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return jsonError("AGENT AERIS backend timed out.", 504);
    }

    return jsonError("Unable to connect to AERIS CHAT backend.", 503);
  }
}
