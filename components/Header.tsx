"use client";

import { useEffect, useState } from "react";
import { Pill } from "./ui/Card";
import { useConnectionStatus } from "@/services/connection-status";

export function Header() {
  const online = useConnectionStatus();
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-PH", {
          hour12: false,
          timeZone: "Asia/Manila",
        }) + " PHT",
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="h-11 px-3 flex items-center justify-between border-b border-aeris-border bg-aeris-surface/95 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/assets/AERIS%20LOGO.svg"
            alt=""
            className="h-7 w-auto shrink-0 object-contain object-left"
            width={120}
            height={28}
            loading="eager"
            aria-hidden
          />
          <span className="live-dot" aria-hidden />
          <span className="font-mono text-sm tracking-[0.2em] text-aeris-accent">
            A.E.R.I.S.
          </span>
          <span className="hud-text text-aeris-muted">
            Autonomous Emergency Response Intelligence System · PH
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {online ? (
          <Pill tone="ok">LIVE</Pill>
        ) : (
          <Pill tone="warn">OFFLINE — stale data</Pill>
        )}
        <span className="hud-text text-aeris-muted tabular-nums">{time}</span>
      </div>
    </header>
  );
}
