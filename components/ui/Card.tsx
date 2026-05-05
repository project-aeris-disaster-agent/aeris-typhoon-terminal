"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  dense,
}: {
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div
      className={clsx(
        "panel-glass rounded-xl",
        dense ? "p-2" : "p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="min-w-0">
        <div className="hud-text text-aeris-muted">{title}</div>
        {subtitle ? (
          <div className="text-xs text-aeris-muted/80 mt-0.5 truncate">
            {subtitle}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger" | "accent";
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-aeris-elev/80 text-aeris-muted border-aeris-border",
    ok: "bg-aeris-ok/10 text-aeris-ok border-aeris-ok/30",
    warn: "bg-aeris-warn/10 text-aeris-warn border-aeris-warn/30",
    danger: "bg-aeris-danger/10 text-aeris-danger border-aeris-danger/30",
    accent: "bg-aeris-accent/10 text-aeris-accent border-aeris-accent/30",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
