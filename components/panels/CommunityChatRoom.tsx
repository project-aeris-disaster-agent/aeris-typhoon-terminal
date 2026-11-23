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
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useAerisRole } from "@/services/role-context";

type ChatMessage = {
  id: string;
  room: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
  /** True for local optimistic messages still in flight. */
  pending?: boolean;
};

type ChatMessageWire = {
  id: string;
  room: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

const ROOM = "global";
const MAX_RENDERED = 200;
const NICK_STORAGE_KEY = "aeris.community-chat.nick";

function readCachedNick(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(NICK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCachedNick(nick: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (nick) window.localStorage.setItem(NICK_STORAGE_KEY, nick);
    else window.localStorage.removeItem(NICK_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

function fromWire(row: ChatMessageWire): ChatMessage {
  return {
    id: row.id,
    room: row.room,
    userId: row.user_id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

function appendUnique(
  current: ChatMessage[],
  incoming: ChatMessage,
): ChatMessage[] {
  const existingIdx = current.findIndex((m) => m.id === incoming.id);
  if (existingIdx >= 0) {
    // Server row wins (clears pending state).
    const next = current.slice();
    next[existingIdx] = incoming;
    return next;
  }
  const next = [...current, incoming];
  next.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return next.length > MAX_RENDERED ? next.slice(-MAX_RENDERED) : next;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-PH", {
    hour12: false,
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NickGate({
  onSaved,
  error,
  setError,
}: {
  onSaved: (nick: string) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [nick, setNick] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = nick.trim();
    if (cleaned.length < 2 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/community-chat/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: cleaned }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        displayName?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to save nickname.");
        return;
      }
      onSaved(data.displayName ?? cleaned);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="space-y-1">
        <p className="text-lg font-black text-aeris-text">
          Pick a nickname
        </p>
        <p className="text-body-sm font-bold text-aeris-ink2 leading-relaxed max-w-[220px]">
          Choose how you appear in the room. 2-24 characters, no spaces.
        </p>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-[240px] flex-col gap-2">
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="e.g. juan_dlc"
          maxLength={24}
          autoFocus
          className="aeris-input w-full px-3 py-2 text-body-sm"
        />
        <button
          type="submit"
          disabled={nick.trim().length < 2 || saving}
          className="aeris-btn-cta min-h-[40px] px-3 text-[0.8125rem]"
        >
          {saving ? "Saving…" : "Join chat"}
        </button>
      </form>
      {error && (
        <p className="text-body-sm text-aeris-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CommunityChatRoom({ isActive }: { isActive: boolean }) {
  const { role, userId, authDisabled } = useAerisRole();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Seed from cache so a refresh shows the saved nick immediately instead of
  // flashing the pick-a-nick gate while the profile request is in flight.
  const [nick, setNickState] = useState<string | null>(() => readCachedNick());
  const [nickLoaded, setNickLoaded] = useState<boolean>(() => readCachedNick() !== null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selfId = userId;

  const setNick = useCallback((value: string | null) => {
    setNickState(value);
    writeCachedNick(value);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/community-chat/messages", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as {
        messages?: ChatMessageWire[];
      };
      const rows = Array.isArray(data.messages) ? data.messages : [];
      setMessages((current) => {
        let next = rows.map(fromWire);
        // Preserve in-flight optimistic messages not yet in history.
        const known = new Set(next.map((m) => m.id));
        for (const m of current) {
          if (m.pending && !known.has(m.id)) next = appendUnique(next, m);
        }
        return next.slice(-MAX_RENDERED);
      });
    } catch {
      // History stays as-is; realtime/poll will catch up.
    }
  }, []);

  // Load nick + history when the panel becomes active. The nickname is only
  // ever cleared when the server *explicitly* reports no profile (200 with a
  // null displayName). Transient failures (401 during a Privy token refresh,
  // network blips, slow server) keep the cached nick so it never disappears
  // on refresh.
  useEffect(() => {
    if (!isActive) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    (async () => {
      try {
        const res = await fetch("/api/community-chat/profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            displayName?: string | null;
          };
          // 200 is authoritative: set or clear the nick from the server truth.
          setNick(data.displayName ?? null);
        }
        // Non-OK (401/403/5xx): keep whatever nick we already have (cache).
      } catch {
        // Aborted/offline: keep cached nick.
      } finally {
        window.clearTimeout(timeout);
        setNickLoaded(true);
      }
    })();
    void loadHistory();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isActive, loadHistory, setNick]);

  // Supabase Realtime: live INSERT fan-out for the global room.
  useEffect(() => {
    if (!isActive) return;

    let client: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      client = createSupabaseBrowserClient();
    } catch {
      return; // Supabase env missing (local dev) — poll fallback below.
    }

    const channel = client
      .channel("community-chat")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_chat_messages",
          filter: `room=eq.${ROOM}`,
        },
        (payload) => {
          const row = payload.new as ChatMessageWire;
          if (!row?.id) return;
          setMessages((current) => appendUnique(current, fromWire(row)));
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      setLive(false);
      void client.removeChannel(channel);
    };
  }, [isActive]);

  // Poll fallback while realtime isn't connected yet (or if the socket drops).
  // Starts fast so messages still flow if the websocket fails to attach, then
  // backs off exponentially (with jitter) toward a 30s cap. Supabase realtime
  // drops are exactly when load is high, so a fixed 4s poll across every viewer
  // would amplify the outage; backoff + jitter avoids that stampede. The effect
  // tears down when `live` flips true, so reconnecting resets the delay to 4s.
  useEffect(() => {
    if (!isActive || live) return;
    const BASE_MS = 4000;
    const MAX_MS = 30000;
    let stopped = false;
    let timer = 0;
    let delay = BASE_MS;

    const tick = () => {
      if (stopped) return;
      void loadHistory();
      delay = Math.min(delay * 2, MAX_MS);
      timer = window.setTimeout(tick, delay + Math.random() * 1000);
    };

    timer = window.setTimeout(tick, BASE_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [isActive, live, loadHistory]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const body = input.trim();
      if (!body || sending || !nick) return;

      const id = makeId();
      const optimistic: ChatMessage = {
        id,
        room: ROOM,
        userId: selfId ?? "self",
        displayName: nick,
        body,
        createdAt: new Date().toISOString(),
        pending: true,
      };

      setMessages((current) => appendUnique(current, optimistic));
      setInput("");
      setSending(true);
      setError(null);

      try {
        const res = await fetch("/api/community-chat/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, clientMessageId: id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: ChatMessageWire;
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          setMessages((current) => current.filter((m) => m.id !== id));
          if (data.code === "nick_required") setNick(null);
          setError(data.error ?? "Failed to send message.");
          return;
        }
        if (data.message) {
          const confirmed = fromWire(data.message);
          setMessages((current) => appendUnique(current, confirmed));
        }
      } catch {
        setMessages((current) => current.filter((m) => m.id !== id));
        setError("Network error. Message not sent.");
      } finally {
        setSending(false);
      }
    },
    [input, sending, nick, selfId],
  );

  const roleBadge = useMemo(() => {
    if (authDisabled) return "DEV";
    if (role === "admin") return "ADMIN";
    if (role === "volunteer") return "VOL";
    return null;
  }, [role, authDisabled]);

  if (!nickLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-body-sm font-bold text-aeris-muted">Connecting…</span>
      </div>
    );
  }

  if (!nick) {
    return <NickGate onSaved={setNick} error={error} setError={setError} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Message list */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="px-1 py-4 text-center text-body-sm font-bold text-aeris-muted">
            No messages yet. Say hello to the room.
          </p>
        )}
        {messages.map((m) => {
          const own = selfId ? m.userId === selfId : m.displayName === nick;
          return (
            <div
              key={m.id}
              // Compact room log; your own lines sit on the chip-blue fill.
              className={clsx(
                "rounded-lg px-2 py-1 text-body-sm leading-snug",
                own && "bg-aeris-chip-on",
                m.pending && "opacity-60",
              )}
            >
              <span className="mr-1.5 text-[0.6875rem] font-bold tabular-nums text-aeris-muted">
                {formatTime(m.createdAt)}
              </span>
              <span
                className={clsx(
                  "mr-1 font-black",
                  own ? "text-aeris-kicker-ink" : "text-aeris-text",
                )}
              >
                {m.displayName}:
              </span>
              <span className="break-words font-semibold text-aeris-text">{m.body}</span>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="px-2 pb-1 text-body-sm text-aeris-warn" role="alert">
          {error}
        </p>
      )}

      {/* Composer */}
      <form
        onSubmit={send}
        className="flex shrink-0 items-center gap-1.5 border-t border-aeris-border/70 px-2.5 py-2"
      >
        <span className="shrink-0 text-body-sm font-black text-aeris-kicker-ink">
          {nick}
        </span>
        {roleBadge && (
          <span className="shrink-0 rounded-full bg-aeris-elev px-1.5 py-px text-[0.625rem] font-black uppercase tracking-[0.1em] text-aeris-ink2">
            {roleBadge}
          </span>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message #global"
          maxLength={280}
          className="aeris-input min-w-0 flex-1 !rounded-full px-3 py-1.5 text-body-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="aeris-btn-ghost h-8 shrink-0 !rounded-full px-3 text-body-sm disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
