"use client";

import type { RefObject } from "react";
import { memo, useEffect, useState } from "react";
import { clsx } from "clsx";
import { AERIS_BRAND } from "@/lib/aeris-brand-assets";
import { formatAerisRoleLabel, getAerisRoleDescription } from "@/lib/aeris-roles";
import { Kicker } from "./ui/Kit";
import { useConnectionStatus } from "@/services/connection-status";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useAerisRole } from "@/services/role-context";
import { useUserProfile } from "@/services/profile-context";
import { HeaderSignOut } from "@/components/HeaderSignOut";
import { ProfileOverlay } from "@/components/ProfileOverlay";
import { NewsTicker } from "@/components/NewsTicker";
import { useUnreadLiveReports } from "@/hooks/useUnreadLiveReports";
import { isTypingTarget } from "@/lib/hotkeys";
import { TUTORIAL_OPEN_EVENT } from "@/lib/tutorial/storage";

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
  const { profile } = useUserProfile();
  const [time, setTime] = useState(formatManilaClock);
  const [profileOpen, setProfileOpen] = useState(false);
  const showAuthControls = !authDisabled && Boolean(userId);
  const showProfile = showAuthControls || authDisabled;
  const unreadReports = useUnreadLiveReports(liveReportsOpen);
  const hasUnreadReports = unreadReports > 0;

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
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        toggleLiveReports();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveReportsOpen, toggleLiveReports, closeLiveReports]);

  return (
    <>
    {/* FLOOD CONTROL status bar: floating white pill clusters on the sky. */}
    <header className="aeris-sky relative z-40 flex min-h-14 shrink-0 items-center justify-between gap-2 px-2 py-2 sm:gap-3 sm:px-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div className="aeris-pill-surface relative z-10 flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3.5">
          <div
            className="aeris-loading-glyph-spin h-7 w-7 shrink-0"
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={AERIS_BRAND.glyph}
              alt=""
              aria-hidden
              decoding="async"
              className="block h-full w-auto max-w-full object-contain object-left"
            />
          </div>
          <span className="truncate text-[0.9375rem] font-black tracking-[0.01em] text-aeris-text">
            A.E.R.I.S.
          </span>
          <span className="hidden min-w-0 truncate text-[0.8125rem] font-extrabold text-aeris-muted xl:inline-block">
            Emergency reporting for the Philippines
          </span>
        </div>
        {online ? (
          <Kicker className="hidden shrink-0 sm:inline-flex">Live</Kicker>
        ) : (
          <Kicker
            live={false}
            className="hidden shrink-0 !bg-aeris-warm/15 !text-aeris-warn sm:inline-flex"
          >
            Offline
          </Kicker>
        )}
        {/*
          suppressHydrationWarning: the clock string is computed at render time
          (useState(formatManilaClock)), so the server HTML carries the build/
          request minute and the client hydrates with the current one — a
          guaranteed text mismatch that fired React #418 on every page load
          (and the dev overlay with it). This is React's documented use of the
          flag: a single text node that legitimately differs across the
          SSR/hydration gap. The effect-driven tick corrects it immediately;
          keeping the SSR time visible beats flashing a placeholder.
        */}
        <span
          suppressHydrationWarning
          className="aeris-pill-surface hidden shrink-0 rounded-full px-3 py-1.5 text-[0.8125rem] font-black tabular-nums text-aeris-text md:inline"
        >
          {time}
        </span>
      </div>

      <div className="relative z-10 flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2">
        <NewsTicker className="aeris-pill-surface hidden h-9 rounded-full px-3 lg:flex max-w-[min(38vw,36rem)] xl:max-w-[min(52vw,36rem)]" />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(TUTORIAL_OPEN_EVENT))}
          className="aeris-round shrink-0 !px-0 text-body-sm font-black"
          aria-label="Show the dashboard tutorial"
          title="Tutorial (A.E.R.I.S. and Disaster Minds)"
        >
          ?
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="aeris-round shrink-0 !px-0"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title="Toggle light/dark theme"
        >
          {theme === "dark" ? (
            <SunIcon className="h-4 w-4" />
          ) : (
            <MoonIcon className="h-4 w-4" />
          )}
        </button>
        <div className="relative" ref={liveReportsTriggerRef}>
          <button
            type="button"
            data-tour="reports"
            onClick={toggleLiveReports}
            className={clsx(
              "aeris-round shrink-0 sm:!px-3.5",
              liveReportsOpen
                ? "!border-aeris-accent/40 !bg-aeris-chip-on !text-aeris-kicker-ink"
                : hasUnreadReports
                  ? "!border-aeris-danger/30 !bg-aeris-danger/10 !text-aeris-danger"
                  : "",
            )}
            aria-expanded={liveReportsOpen}
            aria-controls="live-reports-popover"
            aria-label={
              hasUnreadReports
                ? `Live reports, ${unreadReports} unread`
                : "Live reports"
            }
            title={
              hasUnreadReports
                ? `Live reports — ${unreadReports} unread (shortcut 6)`
                : "Live reports (shortcut 6)"
            }
          >
            <span className="relative shrink-0">
              <AlertTriangleIcon className="h-4 w-4" />
              {hasUnreadReports && !liveReportsOpen ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-aeris-danger px-0.5 text-[9px] font-bold leading-none text-white">
                  {unreadReports > 99 ? "99+" : unreadReports}
                </span>
              ) : null}
            </span>
            <span className="hidden text-body-sm font-extrabold sm:inline">Reports</span>
          </button>
        </div>

        {showProfile && (
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className={clsx(
              "aeris-round shrink-0 !pl-1 sm:!pr-3",
              profileOpen && "!bg-aeris-chip-on !text-aeris-kicker-ink",
            )}
            aria-expanded={profileOpen}
            aria-label="Open profile"
            title="Profile & level"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cta text-[11px] font-black text-white">
              {(profile?.username ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-body-sm font-black tabular-nums sm:inline">
              Lv {profile?.level ?? 0}
            </span>
            {showAuthControls && (
              <span
                className={clsx(
                  "hidden rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4 md:inline",
                  role === "admin"
                    ? "border-aeris-ok/30 bg-aeris-ok/10 text-aeris-ok"
                    : "border-aeris-warn/30 bg-aeris-warn/10 text-aeris-warn",
                )}
                title={getAerisRoleDescription(role)}
              >
                {formatAerisRoleLabel(role)}
              </span>
            )}
          </button>
        )}
        {showAuthControls && <HeaderSignOut />}
      </div>
    </header>
    {showProfile && (
      <ProfileOverlay open={profileOpen} onClose={() => setProfileOpen(false)} />
    )}
    </>
  );
});
