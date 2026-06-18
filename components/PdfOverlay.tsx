"use client";

import { useEffect, useState } from "react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

export type PdfOverlayConfig = {
  /** Official source PDF URL (used for the "open in new tab" fallback). */
  url: string;
  title: string;
  subtitle: string;
};

/**
 * Renders a PDF inside an in-app popup instead of opening a new browser tab.
 *
 * The PDF is streamed through the same-origin `/api/pagasa-bulletin-pdf` proxy
 * so the embed never trips cross-origin frame restrictions. An "Open ↗" link to
 * the original source is always kept as a fallback for environments where the
 * browser refuses to render embedded PDFs.
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

  useEffect(() => {
    if (!open) {
      setLoaded(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !config) return null;

  const proxiedUrl = `/api/pagasa-bulletin-pdf?url=${encodeURIComponent(config.url)}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-aeris-bg/70 backdrop-blur-sm p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={config.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-aeris-border bg-aeris-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-aeris-border bg-aeris-elev/60 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-aeris-accent" />
            <div className="min-w-0">
              <div className="truncate text-body-sm font-semibold text-aeris-text">
                {config.title}
              </div>
              <div className="truncate text-chrome font-mono uppercase tracking-wider text-aeris-muted">
                {config.subtitle}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={config.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-aeris-border px-2 py-1 text-body-sm font-mono text-aeris-muted transition-colors hover:border-aeris-border/60 hover:bg-aeris-elev/50 hover:text-aeris-text"
              title="Open in new tab"
            >
              Open ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-aeris-border px-2 py-1 text-body-sm font-mono text-aeris-muted transition-colors hover:border-aeris-danger/60 hover:bg-aeris-danger/5 hover:text-aeris-danger"
              title="Close (Esc)"
              aria-label="Close"
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-black">
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-aeris-bg/60">
              <AerisLoadingLogo size="md" variant="splash" />
              <div className="text-body-sm font-mono uppercase tracking-wider text-aeris-muted">
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
        </div>
      </div>
    </div>
  );
}
