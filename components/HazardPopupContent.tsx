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
    <div className="relative overflow-hidden rounded-sm border-2 border-red-600 bg-black text-neutral-100 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_8px_24px_rgba(220,38,38,0.15)]">
      <div className="pointer-events-none absolute inset-0 text-red-500/[0.12] md:text-red-500/20">
        <DotPattern width={20} height={20} cr={0.45} />
      </div>
      <div className="relative z-10 space-y-2.5 p-3 font-sans">
        <div className="font-mono text-[10px] text-neutral-500">{coord}</div>
        {barangayName ? (
          <div className="text-sm font-medium text-neutral-200">{barangayName}</div>
        ) : null}
        {report ? (
          <div className="space-y-2.5 border-t border-red-900/60 pt-2.5">
            <div className="font-mono text-[10px] font-medium uppercase tracking-wide text-red-400">
              {report.category}
            </div>
            <div className="flex flex-wrap gap-1 font-mono text-[9px] uppercase">
              <span className="rounded-full border border-red-500/70 bg-red-950/40 px-1.5 py-0.5 text-red-200/90">
                {report.verificationStatus}
              </span>
              <span className="rounded-full border border-neutral-700 px-1.5 py-0.5 text-neutral-400">
                {report.confidenceLabel} confidence
              </span>
              <span className="rounded-full border border-neutral-700 px-1.5 py-0.5 text-neutral-400">
                mint {report.onchainStatus}
              </span>
            </div>
            <div className="rounded border border-red-900/80 bg-neutral-950/80 p-2.5">
              <div className="font-mono text-[9px] font-semibold uppercase tracking-wider text-red-500/90">
                Message
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-neutral-100">
                {messageBody ? messageBody : (
                  <span className="text-neutral-500 italic">No message text</span>
                )}
              </p>
            </div>
            {report.messageId ? (
              <div className="font-mono text-[10px] text-neutral-500">
                id: {report.messageId}
              </div>
            ) : null}
            <div className="font-mono text-[10px] text-neutral-500">
              source: {report.sourceLine}
            </div>
            {report.reportedAt ? (
              <div className="font-mono text-[10px] text-neutral-500">
                reported: {report.reportedAt}
              </div>
            ) : null}
            {report.basescanTxHref ? (
              <a
                href={report.basescanTxHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-cyan-400 underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-300 hover:decoration-cyan-300"
              >
                View BASE transaction
              </a>
            ) : null}
            {report.photoHref ? (
              <a
                href={report.photoHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-cyan-400 underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-300 hover:decoration-cyan-300"
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
