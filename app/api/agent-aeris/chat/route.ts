import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isSpam, sanitizeText } from "@/lib/sanitize";
import {
  insertAssistantAgentMessage,
  insertUserAgentMessage,
} from "@/lib/supabase-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

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

  const context = record.context ?? null;
  const systemContext: ChatMessage = {
    role: "system",
    content: sanitizeText(
      `You are AGENT AERIS inside the AERIS dashboard. Use this compact dashboard context when relevant: ${compactJson(context)}`,
      2000,
    ),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        messages: [systemContext, ...messages].map((message) => ({
          role: message.role,
          content: message.content,
        })),
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

    void insertUserAgentMessage(latestUserMessage.content);
    void insertAssistantAgentMessage(assistantText);

    return jsonOkNoStore({ message: assistantText });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return jsonError("AGENT AERIS backend timed out.", 504);
    }

    return jsonError("Unable to connect to AERIS CHAT backend.", 503);
  }
}
