"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { HelpId } from "@/config/help-content";
import { HelpHint } from "@/components/ui/HelpTooltip";

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
        dense ? "p-2.5" : "p-4",
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
  helpId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** When set, renders a help affordance next to the title. */
  helpId?: HelpId;
}) {
  return (
    <div className="mb-2 min-w-0">
      <div className="hud-text flex flex-wrap items-center gap-1.5 text-aeris-muted">
        {title ? <span>{title}</span> : null}
        {helpId ? <HelpHint helpId={helpId} side="bottom" /> : null}
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {subtitle ? (
        <div className="text-body-sm text-aeris-muted/80 mt-0.5 truncate">
          {subtitle}
        </div>
      ) : null}
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
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-chrome font-sans normal-case tracking-normal",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
