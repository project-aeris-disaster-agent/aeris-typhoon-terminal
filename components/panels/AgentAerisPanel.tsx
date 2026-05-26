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
import { AerisVrmAvatar } from "@/components/agent/AerisVrmAvatar";

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
};

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
};

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
  };
}

export function AgentAerisPanel({
  selectedLocation,
  isActive,
}: AgentAerisPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([INITIAL_MESSAGE]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
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

  const loadHistory = useCallback(async () => {
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
      }>;
    };

    const rows = Array.isArray(body.messages) ? body.messages : [];
    const mapped = rows
      .map(mapHistoryRow)
      .filter((m): m is AgentMessage => Boolean(m));

    if (mapped.length > 0) {
      setMessages(mapped);
    }
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!isActive || historyLoaded) return;
    void loadHistory();
  }, [isActive, historyLoaded, loadHistory]);

  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => {
      void loadHistory();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [isActive, loadHistory]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, isSending]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt || isSending) return;

      const userMessage: AgentMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: cleanPrompt,
        source: "user",
      };
      const pendingAssistantId = `assistant-${Date.now()}`;
      const nextMessages = [...messages, userMessage];

      setMessages([
        ...nextMessages,
        {
          id: pendingAssistantId,
          role: "assistant",
          content: "Analyzing dashboard context...",
        },
      ]);
      setInput("");
      setError(null);
      setIsSending(true);
      lastPromptRef.current = cleanPrompt;

      const response = await fetch("/api/agent-aeris/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          context,
        }),
      });

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
            ? { ...message, content: assistantText, source: "assistant" }
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
      void loadHistory();
    },
    [
      context,
      isSending,
      messages,
      loadHistory,
      replyToChatSession,
      activeBackChannel,
    ],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendPrompt(input);
  };

  const retryLastPrompt = () => {
    if (lastPromptRef.current) void sendPrompt(lastPromptRef.current);
  };

  return (
    <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden rounded-lg border border-aeris-border/60 bg-aeris-bg/40">
      <AgentAvatarColumn>
        <AerisVrmAvatar isActive={isActive} isSpeaking={isSending} />
      </AgentAvatarColumn>

      <div className="flex min-w-0 flex-1 flex-col">
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
                  "max-w-[92%] rounded-lg border px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap",
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
                <div className="mb-1 flex items-center gap-2 text-[8px] font-mono uppercase tracking-widest text-aeris-muted/70">
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
          <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md border border-aeris-danger/40 bg-aeris-danger/10 px-2 py-1.5 text-[10px] text-aeris-text">
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
          <label className="mx-3 mb-1 flex items-center gap-2 text-[10px] text-aeris-muted/90">
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

        <form
          onSubmit={handleSubmit}
          className="flex gap-2 border-t border-aeris-border/50 p-2"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isSending}
            placeholder="Ask AGENT AERIS..."
            className="min-w-0 flex-1 rounded-md border border-aeris-border/60 bg-aeris-bg/70 px-3 py-2 text-[11px] text-aeris-text outline-none placeholder:text-aeris-muted/50 focus:border-aeris-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className="rounded-md border border-aeris-accent/40 bg-aeris-accent/10 px-3 py-2 text-[10px] font-mono font-semibold uppercase tracking-widest text-aeris-accent transition-colors hover:bg-aeris-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function AgentAvatarColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden w-[34%] min-w-[132px] max-w-[220px] border-r border-aeris-border/50 bg-aeris-bg/30 md:block">
      {children}
    </div>
  );
}
