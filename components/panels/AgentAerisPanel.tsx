"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { clsx } from "clsx";
import { AerisVrmAvatar } from "@/components/agent/AerisVrmAvatar";

type AgentRole = "user" | "assistant";

type AgentMessage = {
  id: string;
  role: AgentRole;
  content: string;
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
    "AERIS online. Ask for a concise readout, local risk context, or response checklist for the selected area.",
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

export function AgentAerisPanel({
  selectedLocation,
  isActive,
}: AgentAerisPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPromptRef = useRef<string | null>(null);

  const context = useMemo(
    () => buildDashboardContext(selectedLocation),
    [selectedLocation],
  );

  const sendPrompt = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt || isSending) return;

      const userMessage: AgentMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: cleanPrompt,
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

      try {
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
          const fallback = "AGENT AERIS backend is unavailable.";
          throw new Error(extractAssistantText(data) || fallback);
        }

        const assistantText =
          extractAssistantText(data) ||
          "I could not generate a response from the current backend payload.";

        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantId
              ? { ...message, content: assistantText }
              : message,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to reach AGENT AERIS right now.";
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
      } finally {
        setIsSending(false);
      }
    },
    [context, isSending, messages],
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
      <div className="hidden w-[34%] min-w-[132px] max-w-[220px] border-r border-aeris-border/50 bg-aeris-bg/30 md:block">
        <AerisVrmAvatar isActive={isActive} isSpeaking={isSending} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={clsx(
                "max-w-[92%] rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                message.role === "user"
                  ? "ml-auto border-aeris-accent/30 bg-aeris-accent/10 text-aeris-text"
                  : "border-aeris-border/50 bg-aeris-surface/60 text-aeris-text/90",
              )}
            >
              <div className="mb-1 text-[8px] font-mono uppercase tracking-widest text-aeris-muted/70">
                {message.role === "user" ? "Operator" : "Agent Aeris"}
              </div>
              {message.content}
            </div>
          ))}
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
