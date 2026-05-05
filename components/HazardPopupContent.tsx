"use client";

import { DotPattern } from "@/components/DotPattern";

export type HazardPopupReport = {
  category: string;
  description: string;
  verificationStatus: string;
  confidenceLabel: string;
  onchainStatus: string;
  messageId: string | null;
  sourceLine: string;
  reportedAt: string | null;
  basescanTxHref: string | null;
  photoHref: string | null;
};

export type HazardPopupContentProps = {
  lat: number;
  lng: number;
  barangayName?: string | null;
  report?: HazardPopupReport | null;
};

export function HazardPopupContent({
  lat,
  lng,
  barangayName,
  report,
}: HazardPopupContentProps) {
  const coord = `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
  const messageBody = report?.description?.trim() ?? "";

  return (
    <div className="relative overflow-hidden rounded-lg border border-aeris-border bg-aeris-surface text-aeris-text shadow-lg">
      <div className="pointer-events-none absolute inset-0 text-aeris-accent/[0.08] md:text-aeris-accent/[0.12]">
        <DotPattern width={20} height={20} cr={0.45} />
      </div>
      <div className="relative z-10 space-y-2.5 p-3 font-sans">
        <div className="font-mono text-[10px] text-aeris-muted">{coord}</div>
        {barangayName ? (
          <div className="text-sm font-medium text-aeris-text">{barangayName}</div>
        ) : null}
        {report ? (
          <div className="space-y-2.5 border-t border-aeris-border pt-2.5">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wide text-aeris-danger">
              {report.category}
            </div>
            <div className="flex flex-wrap gap-1 font-mono text-[9px] uppercase">
              <span className="rounded-full border border-aeris-danger/35 bg-aeris-danger/10 px-1.5 py-0.5 text-aeris-danger">
                {report.verificationStatus}
              </span>
              <span className="rounded-full border border-aeris-border px-1.5 py-0.5 text-aeris-muted">
                {report.confidenceLabel} confidence
              </span>
              <span className="rounded-full border border-aeris-border px-1.5 py-0.5 text-aeris-muted">
                mint {report.onchainStatus}
              </span>
            </div>
            <div className="rounded border border-aeris-border bg-aeris-elev/40 p-2.5">
              <div className="font-mono text-[9px] font-semibold uppercase tracking-wider text-aeris-danger">
                Message
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-aeris-text">
                {messageBody ? messageBody : (
                  <span className="text-aeris-muted italic">No message text</span>
                )}
              </p>
            </div>
            {report.messageId ? (
              <div className="font-mono text-[10px] text-aeris-muted">
                id: {report.messageId}
              </div>
            ) : null}
            <div className="font-mono text-[10px] text-aeris-muted">
              source: {report.sourceLine}
            </div>
            {report.reportedAt ? (
              <div className="font-mono text-[10px] text-aeris-muted">
                reported: {report.reportedAt}
              </div>
            ) : null}
            {report.basescanTxHref ? (
              <a
                href={report.basescanTxHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-aeris-accent underline decoration-aeris-accent/40 underline-offset-2 hover:text-aeris-text hover:decoration-aeris-text"
              >
                View BASE transaction
              </a>
            ) : null}
            {report.photoHref ? (
              <a
                href={report.photoHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-aeris-accent underline decoration-aeris-accent/40 underline-offset-2 hover:text-aeris-text hover:decoration-aeris-text"
              >
                Open photo
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
