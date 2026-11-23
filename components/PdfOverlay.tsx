"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

export type PdfOverlayConfig = {
  /** Official source PDF URL (used for the "open in new tab" fallback). */
  url: string;
  title: string;
  subtitle: string;
};

type Rect = { x: number; y: number; width: number; height: number };

const MIN_WIDTH = 360;
const MIN_HEIGHT = 320;
const EDGE_MARGIN = 24;
/** Keep at least this much of the header draggable back into view. */
const MIN_VISIBLE = 48;

function defaultRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(1400, vw - EDGE_MARGIN * 2);
  const height = Math.min(900, vh - EDGE_MARGIN * 2);
  return {
    width,
    height,
    x: Math.max(EDGE_MARGIN, (vw - width) / 2),
    y: Math.max(EDGE_MARGIN, (vh - height) / 2),
  };
}

function clampRect(rect: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), vw);
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), vh);
  const x = Math.min(Math.max(rect.x, MIN_VISIBLE - width), vw - MIN_VISIBLE);
  const y = Math.min(Math.max(rect.y, 0), vh - MIN_VISIBLE);
  return { x, y, width, height };
}

/**
 * Renders a PDF inside a floating, draggable, resizable in-app window instead
 * of opening a new browser tab.
 *
 * The PDF is streamed through the same-origin `/api/pagasa-bulletin-pdf` proxy
 * so the embed never trips cross-origin frame restrictions. An "Open ↗" link to
 * the original source and a "Pop out" real-window option are always kept as
 * fallbacks for environments where the browser refuses to render embedded PDFs.
 */
export function PdfOverlay({
  open,
  onClose,
  config,
}: {
  open: boolean;
  onClose: () => void;
  config: PdfOverlayConfig | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  // While true, a transparent guard covers the iframe so drag/resize pointer
  // events aren't swallowed by the embedded PDF viewer's own event handling.
  const [interacting, setInteracting] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    startRect: Rect;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setLoaded(false);
      return;
    }
    setRect((current) => current ?? defaultRect());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep the window on-screen if the browser viewport shrinks (e.g. rotate).
  useEffect(() => {
    if (!open) return;
    const onResize = () => setRect((current) => (current ? clampRect(current) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const beginDrag = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      if (!rect || e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: rect };
      setInteracting(true);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        setRect(
          clampRect(
            drag.mode === "move"
              ? { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy }
              : {
                  ...drag.startRect,
                  width: drag.startRect.width + dx,
                  height: drag.startRect.height + dy,
                },
          ),
        );
      };
      const onUp = () => {
        dragRef.current = null;
        setInteracting(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rect],
  );

  if (!open || !config || !rect) return null;

  const proxiedUrl = `/api/pagasa-bulletin-pdf?url=${encodeURIComponent(config.url)}`;

  const popOut = () => {
    const w = Math.min(1000, window.screen.availWidth - 80);
    const h = Math.min(1200, window.screen.availHeight - 80);
    window.open(
      proxiedUrl,
      "_blank",
      `popup=yes,width=${w},height=${h},noopener,noreferrer`,
    );
  };

  // Portalled to <body> so this modal escapes ancestor stacking contexts
  // (e.g. the sidebar's `backdrop-blur`, which otherwise traps `z-[60]`
  // inside the sidebar's local paint order and renders it under the map).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-aeris-navy/35 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={config.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        // The game's settings sheet: frosted card, hero shadow, kicker header.
        className="panel-glass absolute flex flex-col overflow-hidden rounded-2xl !shadow-hero"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        <div
          className="flex shrink-0 cursor-move touch-none items-center justify-between gap-2 border-b border-aeris-border/70 px-3.5 py-2.5"
          onPointerDown={beginDrag("move")}
        >
          <div className="min-w-0">
            <span className="aeris-kicker max-w-full truncate">{config.subtitle}</span>
            <div className="mt-1 truncate text-body font-black text-aeris-text">
              {config.title}
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-1.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={popOut}
              className="aeris-btn-soft h-8 px-3 text-body-sm"
              title="Pop out into its own window"
            >
              Pop out ⇱
            </button>
            <a
              href={config.url}
              target="_blank"
              rel="noopener noreferrer"
              className="aeris-btn-soft h-8 px-3 text-body-sm"
              title="Open original source in new tab"
            >
              Open ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              className="aeris-round !h-8 !min-w-8 !px-0 hover:!text-aeris-danger"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-black">
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-aeris-surface">
              <AerisLoadingLogo size="md" variant="glyph" />
              <div className="aeris-label">
                Loading bulletin…
              </div>
            </div>
          )}
          <iframe
            src={proxiedUrl}
            title={config.title}
            className="h-full w-full border-0"
            onLoad={() => setLoaded(true)}
          />
          {interacting && <div className="absolute inset-0 z-10 cursor-inherit" />}
        </div>

        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          onPointerDown={beginDrag("resize")}
          title="Resize"
        >
          <svg viewBox="0 0 16 16" className="h-full w-full text-aeris-muted/60" aria-hidden>
            <path
              d="M14 2 L2 14 M14 7 L7 14 M14 12 L12 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  );
}
