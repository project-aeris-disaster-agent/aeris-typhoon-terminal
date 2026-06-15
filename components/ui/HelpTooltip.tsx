"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { clsx } from "clsx";
import { HelpCircle } from "lucide-react";
import { HELP, type HelpId } from "@/config/help-content";
import { requestAgentExplain } from "@/lib/help/agent-explain";

const LONG_PRESS_MS = 500;

type Side = "top" | "bottom" | "left" | "right";

/**
 * A small "?" affordance that reveals an explanation tooltip on hover/focus
 * (or tap on touch devices), and asks Agent AERIS to explain the topic on
 * long-press / right-click.
 */
export function HelpHint({
  helpId,
  side = "top",
  className,
  label,
}: {
  helpId: HelpId;
  side?: Side;
  className?: string;
  /** Override the accessible label; defaults to the registry title. */
  label?: string;
}) {
  const entry = HELP[helpId];
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const accessibleLabel = label ?? entry?.title ?? "Help";

  const computePosition = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const gap = 8;
    let top = rect.top;
    let left = rect.left + rect.width / 2;
    switch (side) {
      case "bottom":
        top = rect.bottom + gap;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
      case "top":
      default:
        top = rect.top - gap;
        break;
    }
    setCoords({ top, left });
  }, [side]);

  const show = useCallback(() => {
    computePosition();
    setOpen(true);
  }, [computePosition]);

  const hide = useCallback(() => setOpen(false), []);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback(() => {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      hide();
      requestAgentExplain(helpId);
    }, LONG_PRESS_MS);
  }, [clearLongPress, helpId, hide]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onScrollOrResize = () => computePosition();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, hide, computePosition]);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  if (!entry) return null;

  const positionStyle: CSSProperties | undefined = coords
    ? {
        top: coords.top,
        left: coords.left,
        transform:
          side === "top"
            ? "translate(-50%, -100%)"
            : side === "bottom"
              ? "translate(-50%, 0)"
              : side === "left"
                ? "translate(-100%, -50%)"
                : "translate(0, -50%)",
      }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Help: ${accessibleLabel}. Hold to ask AERIS.`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className={clsx(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-aeris-muted/70 outline-none transition-colors hover:text-aeris-accent focus-visible:text-aeris-accent focus-visible:ring-1 focus-visible:ring-aeris-accent/50",
          className,
        )}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Touch / click: toggle the tooltip (no hover on touch devices).
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          startLongPress();
        }}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onPointerCancel={clearLongPress}
        onContextMenu={(e) => {
          e.preventDefault();
          hide();
          requestAgentExplain(helpId);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && coords && (
        <div
          id={tooltipId}
          role="tooltip"
          style={positionStyle}
          className="pointer-events-none fixed z-[2000] w-60 max-w-[80vw] rounded-lg border border-aeris-border/70 bg-aeris-surface/95 p-2.5 text-left shadow-[var(--aeris-shadow-up)] backdrop-blur-md"
        >
          <div className="mb-1 text-body-sm font-semibold text-aeris-accent">
            {entry.title}
          </div>
          <p className="text-body text-aeris-text/90">
            {entry.tip}
          </p>
          <div className="mt-1.5 border-t border-aeris-border/40 pt-1.5 chrome-label text-aeris-muted/60">
            Hold to ask AERIS
          </div>
        </div>
      )}
    </>
  );
}
