"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { clsx } from "clsx";
import { AgentSpeechControls } from "@/components/agent/AgentSpeechControls";
import { AerisVrmAvatar } from "@/components/agent/AerisVrmAvatar";
import { useAgentSpeech } from "@/hooks/useAgentSpeech";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import type { AgentExplainRequest } from "@/lib/help/agent-explain";

type AgentRole = "user" | "assistant" | "system";

type AgentMessageSource =
  | "user"
  | "assistant"
  | "system"
  | "weather_report"
  | "operator";

type AgentMessage = {
  id: string;
  role: AgentRole;
  content: string;
  source?: AgentMessageSource;
  sessionId?: string;
  disasterReportId?: string;
  operatorName?: string;
  /** ISO timestamp when known (DB rows). Local-only optimistic messages
   *  have createdAt set to send time so ordering stays correct on merge. */
  createdAt?: string;
  /** True for local optimistic messages still in flight. */
  pending?: boolean;
};

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (older browsers / tests) — RFC4122 v4-ish.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (Math.random() * 16) >> (Number(c) / 4)
    ).toString(16),
  );
}

type AgentLocationContext = {
  name: string;
  breadcrumb?: string;
  lat?: number;
  lon?: number;
  type?: string;
  psgcCode?: string;
  population?: number;
};

type AgentAerisPanelProps = {
  selectedLocation: AgentLocationContext | null;
  isActive: boolean;
  /** When this changes, AERIS is asked to explain a dashboard feature. */
  explainRequest?: AgentExplainRequest | null;
};

const GENERATE_REPORT_PROMPT =
  "Generate a Situation Report (SITREP) for the currently selected location (or a national overview if none is selected). Include: current weather and typhoon status, active alerts and hazards, key risks for the area, and time-boxed recommended actions for the next 24 hours. Keep it concise and broadcast-ready.";

const INITIAL_MESSAGE: AgentMessage = {
  id: "assistant-initial",
  role: "assistant",
  content:
    "AERIS online. Ask for a concise readout, local risk context, or response checklist for the selected area. National weather briefs appear here when conditions warrant.",
};

function buildDashboardContext(location: AgentLocationContext | null) {
  return {
    dashboard: "AERIS Typhoon Resilience Terminal",
    regionLock: "Philippines",
    selectedLocation: location
      ? {
          name: location.name,
          breadcrumb: location.breadcrumb,
          type: location.type,
          coordinates:
            typeof location.lat === "number" && typeof location.lon === "number"
              ? {
                  lat: Number(location.lat.toFixed(5)),
                  lon: Number(location.lon.toFixed(5)),
                }
              : undefined,
          psgcCode: location.psgcCode,
          population: location.population,
        }
      : null,
    instruction:
      "Answer as AGENT AERIS for disaster preparedness. Be concise, practical, and state when live data is unavailable.",
  };
}

function extractAssistantText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";

  const obj = data as Record<string, unknown>;
  const candidate = obj.message ?? obj.content ?? obj.response ?? obj.text;
  return typeof candidate === "string" ? candidate : "";
}

function mapHistoryRow(row: {
  id: string;
  role: string;
  source: string;
  content: string;
  session_id?: string | null;
  disaster_report_id?: string | null;
  operator_name?: string | null;
  created_at?: string | null;
}): AgentMessage | null {
  if (row.role !== "user" && row.role !== "assistant" && row.role !== "system") {
    return null;
  }
  return {
    id: row.id,
    role: row.role as AgentRole,
    content: row.content,
    source: row.source as AgentMessageSource,
    sessionId: row.session_id ?? undefined,
    disasterReportId: row.disaster_report_id ?? undefined,
    operatorName: row.operator_name ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

/**
 * Merge DB history with local optimistic state by stable id.
 *
 * Rules:
 *  - DB rows always win on content (server truth).
 *  - Local messages whose id is NOT in the DB set are preserved (still
 *    in-flight) so the just-sent user/assistant pair never disappears.
 *  - Ordering: by createdAt where available, otherwise insertion order.
 */
function mergeMessages(
  local: AgentMessage[],
  fromDb: AgentMessage[],
): AgentMessage[] {
  const dbById = new Map(fromDb.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const merged: AgentMessage[] = [];

  for (const dbMsg of fromDb) {
    merged.push(dbMsg);
    seen.add(dbMsg.id);
  }
  for (const localMsg of local) {
    if (seen.has(localMsg.id)) continue;
    if (dbById.has(localMsg.id)) continue;
    merged.push(localMsg);
    seen.add(localMsg.id);
  }

  merged.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const tb = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    if (ta === tb) return 0;
    return ta - tb;
  });
  return merged;
}

export function AgentAerisPanel({
  selectedLocation,
  isActive,
  explainRequest,
}: AgentAerisPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([INITIAL_MESSAGE]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [seededMessageIds, setSeededMessageIds] = useState<Set<string> | null>(
    null,
  );
  const [muted, setMuted] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyToChatSession, setReplyToChatSession] = useState(true);
  const lastPromptRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Most recent urgent broadcast that originated from a chat session. When
  // present, the operator can back-channel their reply into that chat.
  const activeBackChannel = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.source === "system" && m.sessionId) {
        return {
          sessionId: m.sessionId,
          disasterReportId: m.disasterReportId,
          messageId: m.id,
        };
      }
    }
    return null;
  }, [messages]);

  const context = useMemo(
    () => buildDashboardContext(selectedLocation),
    [selectedLocation],
  );

  const { mouthLevel, emotion, voiceStatus, voiceEngine } = useAgentSpeech({
    messages,
    isActive,
    muted,
    seededMessageIds,
  });

  const loadHistory = useCallback(async () => {
    try {
    const res = await fetch("/api/agent-aeris/messages?limit=50", {
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{
        id: string;
        role: string;
        source: string;
        content: string;
        session_id?: string | null;
        disaster_report_id?: string | null;
        operator_name?: string | null;
        created_at?: string | null;
      }>;
    };

    const rows = Array.isArray(body.messages) ? body.messages : [];
    const mapped = rows
      .map(mapHistoryRow)
      .filter((m): m is AgentMessage => Boolean(m));

    setMessages((current) => {
      if (mapped.length === 0) {
        setSeededMessageIds(new Set([INITIAL_MESSAGE.id]));
        return current;
      }
      // If the only local content is the initial assistant placeholder and
      // we just learned about a real history, drop the placeholder.
      const initialOnly =
        current.length === 1 && current[0].id === INITIAL_MESSAGE.id;
      const local = initialOnly ? [] : current;
      const merged = mergeMessages(local, mapped);
      setSeededMessageIds(new Set(merged.map((m) => m.id)));
      return merged;
    });
    } catch {
      setSeededMessageIds(new Set([INITIAL_MESSAGE.id]));
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isActive || historyLoaded) return;
    void loadHistory();
  }, [isActive, historyLoaded, loadHistory]);

  useVisiblePolling(
    () => {
      // Don't refetch in the middle of a conversation; merge-by-id is safe,
      // but pausing avoids any visual churn while the operator is typing.
      if (isSending || input.length > 0) return;
      void loadHistory();
    },
    30_000,
    // History is seeded by a separate effect on activation, so skip the
    // immediate fire here to avoid a duplicate fetch when the panel opens.
    { enabled: isActive, immediate: false },
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, isSending]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt || isSending) return;

      const userMessageId = makeId();
      const pendingAssistantId = makeId();
      const sentAt = new Date().toISOString();

      const userMessage: AgentMessage = {
        id: userMessageId,
        role: "user",
        content: cleanPrompt,
        source: "user",
        createdAt: sentAt,
      };
      const nextMessages = [...messages, userMessage];

      setMessages([
        ...nextMessages,
        {
          id: pendingAssistantId,
          role: "assistant",
          content: "Analyzing dashboard context...",
          createdAt: sentAt,
          pending: true,
        },
      ]);
      setInput("");
      setError(null);
      setIsSending(true);
      lastPromptRef.current = cleanPrompt;

      let response: Response;
      try {
        response = await fetch("/api/agent-aeris/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            clientUserMessageId: userMessageId,
            clientAssistantMessageId: pendingAssistantId,
            context,
          }),
        });
      } catch {
        // Network-level failure (e.g. "Failed to fetch" when the dev server
        // restarts or the connection drops). Surface it instead of letting the
        // rejection escape this fire-and-forget call as an unhandled error.
        setError("AGENT AERIS is unreachable. Check your connection and retry.");
        setMessages((current) =>
          current.map((item) =>
            item.id === pendingAssistantId
              ? {
                  ...item,
                  content:
                    "Connection failed. Check the AERIS CHAT backend configuration and try again.",
                  pending: false,
                }
              : item,
          ),
        );
        setIsSending(false);
        return;
      }

      const data = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const message =
          extractAssistantText(data) || "AGENT AERIS backend is unavailable.";
        setError(message);
        setMessages((current) =>
          current.map((item) =>
            item.id === pendingAssistantId
              ? {
                  ...item,
                  content:
                    "Connection failed. Check the AERIS CHAT backend configuration and try again.",
                  pending: false,
                }
              : item,
          ),
        );
        setIsSending(false);
        return;
      }

      const assistantText =
        extractAssistantText(data) ||
        "I could not generate a response from the current backend payload.";

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingAssistantId
            ? {
                ...message,
                content: assistantText,
                source: "assistant",
                pending: false,
              }
            : message,
        ),
      );

      // Phase 4.3: optionally back-channel the operator's message into the
      // originating chat session. This sends the operator's exact text (not
      // the LLM response) so the citizen hears from a human.
      if (replyToChatSession && activeBackChannel) {
        void fetch("/api/agent/reply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: cleanPrompt,
            sessionId: activeBackChannel.sessionId,
            disasterReportId: activeBackChannel.disasterReportId,
            respondedToId: activeBackChannel.messageId,
            operatorName: "AERIS Operator",
          }),
        }).catch(() => undefined);
      }

      setIsSending(false);
      // No post-send loadHistory(): the server now awaits both DB writes
      // with the same client-supplied ids, and the next 30s tick will
      // reconcile via mergeMessages without clobbering local state.
    },
    [
      context,
      isSending,
      messages,
      replyToChatSession,
      activeBackChannel,
    ],
  );

  // Long-press / contextmenu on a help affordance dispatches an explain
  // request that flows down to here. Fire it once per request id; the reply
  // is rendered in chat and spoken aloud by useAgentSpeech (unless muted).
  const lastExplainId = useRef<number | null>(null);
  useEffect(() => {
    if (!explainRequest) return;
    if (lastExplainId.current === explainRequest.id) return;
    lastExplainId.current = explainRequest.id;
    void sendPrompt(explainRequest.prompt);
  }, [explainRequest, sendPrompt]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendPrompt(input);
  };

  const retryLastPrompt = () => {
    if (lastPromptRef.current) void sendPrompt(lastPromptRef.current);
  };

  return (
    <div className="relative z-10 flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-aeris-border/60 bg-aeris-bg/40">
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        >
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isUrgentBroadcast =
              message.role === "system" && message.source === "system";
            const isWeather = message.source === "weather_report";
            const isOperatorReply = message.source === "operator";
            const label = isUser
              ? "Operator"
              : isOperatorReply
                ? `Operator → Chat${message.operatorName ? ` (${message.operatorName})` : ""}`
                : isUrgentBroadcast
                  ? "Urgent Incident"
                  : isWeather
                    ? "Weather Brief"
                    : "Agent Aeris";

            return (
              <div
                key={message.id}
                className={clsx(
                  "max-w-[92%] rounded-lg border px-3 py-2 text-body-sm leading-relaxed whitespace-pre-wrap",
                  isUser
                    ? "ml-auto border-aeris-accent/30 bg-aeris-accent/10 text-aeris-text"
                    : isOperatorReply
                      ? "border-emerald-500/40 bg-emerald-500/10 text-aeris-text"
                      : isUrgentBroadcast
                        ? "border-aeris-danger/50 bg-aeris-danger/10 text-aeris-text"
                        : isWeather
                          ? "border-aeris-warn/40 bg-aeris-warn/5 text-aeris-text/90"
                          : "border-aeris-border/50 bg-aeris-surface/60 text-aeris-text/90",
                )}
              >
                <div className="mb-1 flex items-center gap-2 text-label text-aeris-muted/80">
                  <span>{label}</span>
                  {isWeather && (
                    <span className="rounded border border-aeris-warn/30 px-1 py-0.5 text-aeris-warn">
                      Auto
                    </span>
                  )}
                  {isUrgentBroadcast && (
                    <span className="rounded border border-aeris-danger/40 px-1 py-0.5 text-aeris-danger">
                      Auto · Urgent
                    </span>
                  )}
                </div>
                {message.content}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md border border-aeris-danger/40 bg-aeris-danger/10 px-2 py-1.5 text-body-sm text-aeris-text">
            <span className="min-w-0 truncate">{error}</span>
            <button
              type="button"
              onClick={retryLastPrompt}
              className="shrink-0 font-mono uppercase tracking-widest text-aeris-accent hover:text-aeris-text"
            >
              Retry
            </button>
          </div>
        )}

        {activeBackChannel && (
          <label className="mx-3 mb-1 flex items-center gap-2 text-body-sm text-aeris-muted/90">
            <input
              type="checkbox"
              checked={replyToChatSession}
              onChange={(e) => setReplyToChatSession(e.target.checked)}
              className="h-3 w-3 accent-aeris-accent"
            />
            <span>
              Reply to chat session{" "}
              <span className="font-mono text-aeris-accent">
                {activeBackChannel.sessionId.slice(0, 8)}
              </span>
              {activeBackChannel.disasterReportId && (
                <span className="text-aeris-muted/60">
                  {" "}
                  · report {activeBackChannel.disasterReportId.slice(0, 8)}
                </span>
              )}
            </span>
          </label>
        )}

        {/* 3D companion window — docked directly above the Generate Report
            button and chat input, full width so the character is centered.
            Height caps at 38% of the panel so short (landscape) bars keep
            room for the conversation. */}
        <div className="relative h-32 max-h-[38%] shrink-0 overflow-hidden border-t border-aeris-border/50">
          <AgentSpeechControls
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            voiceStatus={voiceStatus}
            voiceEngine={voiceEngine}
          />
          <AerisVrmAvatar
            isActive={isActive}
            mouthLevel={mouthLevel}
            emotion={emotion}
          />
        </div>

        <div className="border-t border-aeris-border/50 px-2 pt-2">
          <button
            type="button"
            onClick={() => void sendPrompt(GENERATE_REPORT_PROMPT)}
            disabled={isSending}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-aeris-accent/40 bg-aeris-accent/10 px-3 py-2 text-body-sm font-semibold text-aeris-accent transition-colors hover:bg-aeris-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M14 3v5h5M9 13h6M9 17h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {isSending ? "Generating…" : "Generate Report"}
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex gap-2 p-2"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
            placeholder="Ask AGENT AERIS..."
            className="min-w-0 flex-1 rounded-md border border-aeris-border/60 bg-aeris-bg/70 px-3 py-2 text-body-sm text-aeris-text outline-none placeholder:text-aeris-muted/50 focus:border-aeris-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className="rounded-md border border-aeris-accent/40 bg-aeris-accent/10 px-3 py-2 text-body-sm font-semibold text-aeris-accent transition-colors hover:bg-aeris-accent/15 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
