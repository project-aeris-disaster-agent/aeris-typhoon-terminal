"use client";

import type { RefObject } from "react";
import { memo, useEffect, useState } from "react";
import Image from "next/image";
import { clsx } from "clsx";
import { Pill } from "./ui/Card";
import { useConnectionStatus } from "@/services/connection-status";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useAerisRole } from "@/services/role-context";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { NewsTicker } from "@/components/NewsTicker";

function AlertTriangleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  );
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}

export type HeaderProps = {
  liveReportsOpen: boolean;
  toggleLiveReports: () => void;
  closeLiveReports: () => void;
  liveReportsTriggerRef: RefObject<HTMLDivElement>;
};

function formatManilaClock(now = new Date()): string {
  return (
    now.toLocaleTimeString("en-PH", {
      hour12: false,
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
    }) + " PHT"
  );
}

export const Header = memo(function Header({
  liveReportsOpen,
  toggleLiveReports,
  closeLiveReports,
  liveReportsTriggerRef,
}: HeaderProps) {
  const online = useConnectionStatus();
  const { theme, toggleTheme } = useTheme();
  const { role, authDisabled, userId } = useAerisRole();
  const [time, setTime] = useState<string>("");
  const showAuthControls = !authDisabled && Boolean(userId);

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  useEffect(() => {
    const tick = () => setTime(formatManilaClock());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && liveReportsOpen) {
        closeLiveReports();
        return;
      }
      if (e.key === "6") {
        const t = e.target as HTMLElement | null;
        if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
        e.preventDefault();
        toggleLiveReports();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveReportsOpen, toggleLiveReports, closeLiveReports]);

  return (
    <header className="relative z-40 h-12 px-3 flex items-center justify-between border-b border-aeris-border bg-aeris-surface/98 max-md:backdrop-blur-none md:bg-aeris-surface/95 md:backdrop-blur-md shrink-0 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative z-10 flex items-center gap-2 min-w-0">
          <Image
            src="/assets/AERIS Glyph@5x.png"
            alt="AERIS"
            className="h-7 w-auto shrink-0 object-contain object-left"
            width={1065}
            height={1214}
            priority
          />
          <span className="live-dot" aria-hidden />
          <span className="font-mono text-sm tracking-[0.2em] text-aeris-accent">
            A.E.R.I.S.
          </span>
          <span className="hud-text text-aeris-muted hidden lg:inline">
            Autonomous Emergency Reporting Intelligence System · PH
          </span>
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-end gap-2">
        <NewsTicker className="hidden md:flex max-w-[min(52vw,36rem)]" />
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 items-center gap-1.5 rounded border border-aeris-border bg-aeris-bg/70 px-2 text-aeris-muted transition-colors hover:border-aeris-accent/40 hover:text-aeris-text"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title="Toggle light/dark theme"
        >
          {theme === "dark" ? (
            <SunIcon className="h-3.5 w-3.5" />
          ) : (
            <MoonIcon className="h-3.5 w-3.5" />
          )}
          <span className="hud-text text-[10px]">{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
        <div className="relative" ref={liveReportsTriggerRef}>
          <button
            type="button"
            onClick={toggleLiveReports}
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors",
              liveReportsOpen
                ? "border-aeris-accent/40 bg-aeris-accent/10 text-aeris-accent"
                : "border-aeris-border text-aeris-muted hover:border-aeris-accent/30 hover:text-aeris-text",
            )}
            aria-expanded={liveReportsOpen}
            aria-controls="live-reports-popover"
            aria-label="Live reports"
            title="Live reports (shortcut 6)"
          >
            <AlertTriangleIcon className="h-4 w-4" />
          </button>
        </div>

        {showAuthControls && (
          <>
            <Pill tone={role === "admin" ? "ok" : "warn"}>{role}</Pill>
            <button
              type="button"
              onClick={() => void signOut()}
              className="hud-text rounded border border-aeris-border px-2 py-1 text-[10px] text-aeris-muted hover:border-aeris-accent/40 hover:text-aeris-text"
            >
              Sign out
            </button>
          </>
        )}
        {online ? (
          <Pill tone="ok">LIVE</Pill>
        ) : (
          <Pill tone="warn">OFFLINE — stale data</Pill>
        )}
        <span className="hud-text text-aeris-muted tabular-nums hidden sm:inline">{time}</span>
      </div>
    </header>
  );
});
