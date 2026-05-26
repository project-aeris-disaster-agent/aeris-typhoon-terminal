"use client";

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

function formatLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id: string) {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function HazardPopupContent({
  lat,
  lng,
  barangayName,
  report,
}: HazardPopupContentProps) {
  const location = barangayName ?? `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
  const messageBody = report?.description?.trim() ?? "";

  if (!report) {
    return (
      <div className="w-[220px] rounded-md border border-aeris-border bg-aeris-surface/95 p-2.5 text-aeris-text shadow-md backdrop-blur-sm">
        <p className="text-xs font-medium">{location}</p>
        <p className="mt-1 font-mono text-[10px] text-aeris-muted">
          {lat.toFixed(4)}°N, {lng.toFixed(4)}°E
        </p>
      </div>
    );
  }

  const showMint =
    report.onchainStatus &&
    report.onchainStatus !== "not_started" &&
    report.onchainStatus !== "skipped";

  const meta: string[] = [];
  if (report.confidenceLabel && report.confidenceLabel !== "unknown") {
    meta.push(`${report.confidenceLabel} confidence`);
  }
  if (report.reportedAt) meta.push(report.reportedAt);
  if (showMint) meta.push(formatLabel(report.onchainStatus));

  return (
    <div className="w-[240px] rounded-md border border-aeris-border bg-aeris-surface/95 p-2.5 text-aeris-text shadow-md backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold leading-tight">
            {formatLabel(report.category)}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-aeris-muted">{location}</p>
        </div>
        <span
          className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase leading-none ${
            report.verificationStatus === "verified"
              ? "bg-aeris-accent/15 text-aeris-accent"
              : "bg-aeris-danger/10 text-aeris-danger"
          }`}
        >
          {formatLabel(report.verificationStatus)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-snug text-aeris-text line-clamp-4">
        {messageBody || (
          <span className="italic text-aeris-muted">No message</span>
        )}
      </p>

      {meta.length > 0 ? (
        <p className="mt-2 font-mono text-[9px] leading-snug text-aeris-muted">
          {meta.join(" · ")}
        </p>
      ) : null}

      {(report.basescanTxHref || report.photoHref) && (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]">
          {report.basescanTxHref ? (
            <a
              href={report.basescanTxHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-aeris-accent hover:underline"
            >
              Transaction
            </a>
          ) : null}
          {report.photoHref ? (
            <a
              href={report.photoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-aeris-accent hover:underline"
            >
              Photo
            </a>
          ) : null}
        </div>
      )}

      <p
        className="mt-1.5 truncate font-mono text-[9px] text-aeris-muted/80"
        title={[report.messageId, report.sourceLine].filter(Boolean).join(" · ")}
      >
        {report.messageId ? shortId(report.messageId) : null}
        {report.messageId && report.sourceLine ? " · " : null}
        {report.sourceLine}
      </p>
    </div>
  );
}
