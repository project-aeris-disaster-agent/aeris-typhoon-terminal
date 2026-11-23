"use client";

/**
 * Small building blocks from the FLOOD CONTROL by bagyo.app design language
 * (bagyogame/src/ui/theme/tokens.ts + landing/landingStyles.ts). The visual
 * rules live in app/globals.css (`aeris-*` classes); these components only
 * pick the right markup and ARIA so every panel uses them the same way.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

/** Status pill with the blinking green live dot (landing `.lp-kicker`). */
export function Kicker({
  children,
  live = true,
  className,
}: {
  children: ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx("aeris-kicker", className)}>
      {live ? <span className="aeris-live-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Tiny spaced-caps section label (landing CITY / DIFFICULTY). */
export function SectionLabel({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "span" | "h3" | "h4";
}) {
  return <Tag className={clsx("aeris-label", className)}>{children}</Tag>;
}

/** Keyboard shortcut cap (HUD `.sh-key`). */
export function HotkeyCap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd className={clsx("aeris-key font-sans", className)} aria-hidden>
      {children}
    </kbd>
  );
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Optional second line (e.g. "Analytical" under "2D"). */
  sub?: ReactNode;
  title?: string;
  disabled?: boolean;
};

/**
 * Segmented control: pale track, white raised segment (landing `.lp-tabs`).
 * Buttons carry `aria-pressed`, which is what the CSS keys the raised state on.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={clsx("aeris-seg", className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={clsx(
            "aeris-seg-btn text-left",
            size === "sm" ? "px-2 py-1 text-[0.75rem]" : "px-2.5 py-1.5 text-body-sm",
          )}
          aria-pressed={o.value === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          <span className="block leading-tight">{o.label}</span>
          {o.sub ? (
            <span className="block text-[0.6875rem] font-bold leading-tight opacity-75">
              {o.sub}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
