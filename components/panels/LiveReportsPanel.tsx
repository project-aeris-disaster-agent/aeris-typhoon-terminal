"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import {
  AlertTriangle,
  ChevronDown,
  MapPin,
  RefreshCw,
  Siren,
} from "lucide-react";
import { CardHeader, Pill } from "../ui/Card";
import {
  reviewReport,
  type ReportReviewAction,
  fetchReports,
  type IncidentReport,
} from "@/services/reports-client";
import { FreshnessTag } from "../ui/FreshnessTag";
import { useAerisRole } from "@/services/role-context";

const AI_PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  low_priority: 1,
  pending: 2,
  rejected: 3,
};

type ReportFilter = "all" | "urgent" | "unverified";

function sortReports(reports: IncidentReport[]) {
  return [...reports].sort((a, b) => {
    const aRank = AI_PRIORITY_ORDER[a.aiPriority ?? "pending"] ?? 2;
    const bRank = AI_PRIORITY_ORDER[b.aiPriority ?? "pending"] ?? 2;
    if (aRank !== bRank) return aRank - bRank;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function aiPriorityTone(priority?: string): "ok" | "warn" | "danger" {
  if (priority === "urgent") return "danger";
  if (priority === "low_priority") return "ok";
  if (priority === "rejected") return "warn";
  return "warn";
}

function reportCardTone(report: IncidentReport): "danger" | "warn" | "ok" | "default" {
  if (report.aiPriority === "urgent") return "danger";
  if (report.verificationStatus === "verified") return "ok";
  if (report.aiPriority === "rejected") return "warn";
  return "default";
}

const CARD_TONE_CLASS: Record<
  ReturnType<typeof reportCardTone>,
  string
> = {
  danger: "border-aeris-danger/45 bg-aeris-danger/10",
  warn: "border-aeris-warn/40 bg-aeris-warn/10",
  ok: "border-aeris-ok/40 bg-aeris-ok/10",
  default: "border-aeris-border/60 bg-aeris-bg/40",
};

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleTimeString("en-PH", { hour12: false });
}

function StatChip({
  label,
  count,
  tone = "default",
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: "default" | "warn" | "danger" | "ok";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-aeris-danger/35 text-aeris-danger"
      : tone === "warn"
        ? "border-aeris-warn/35 text-aeris-warn"
        : tone === "ok"
          ? "border-aeris-ok/35 text-aeris-ok"
          : "border-aeris-border/60 text-aeris-muted";

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "rounded border px-2 py-1 text-left transition-colors",
        toneClass,
        active && "ring-1 ring-aeris-accent/50 bg-aeris-accent/5",
        onClick && "hover:bg-aeris-elev/40 cursor-pointer",
      )}
    >
      <div className="text-[9px] font-mono uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-sm font-mono tabular-nums leading-tight">{count}</div>
    </Tag>
  );
}

function ReportCard({
  report,
  canReview,
  reviewing,
  onFocus,
  onReview,
}: {
  report: IncidentReport;
  canReview: boolean;
  reviewing: boolean;
  onFocus: () => void;
  onReview: (
    event: React.MouseEvent,
    action: ReportReviewAction,
  ) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tone = reportCardTone(report);
  const confidencePct =
    typeof report.confidence === "number"
      ? Math.round(report.confidence * 100)
      : null;

  return (
    <article
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onFocus();
      }}
      role="button"
      tabIndex={0}
      className={clsx(
        "w-full cursor-pointer rounded-md border p-2 text-left transition-colors",
        "hover:border-aeris-accent/40 hover:bg-aeris-accent/5",
        "focus:outline-none focus:border-aeris-accent/50",
        CARD_TONE_CLASS[tone],
      )}
    >
      <header className="mb-1 flex flex-wrap items-center gap-1.5">
        {report.aiPriority === "urgent" ? (
          <Siren size={12} className="shrink-0 text-aeris-danger" aria-hidden />
        ) : (
          <AlertTriangle size={12} className="shrink-0 text-aeris-warn" aria-hidden />
        )}
        <Pill tone="warn">{report.category}</Pill>
        <Pill tone={report.verificationStatus === "verified" ? "ok" : "warn"}>
          {report.verificationStatus ?? "unverified"}
        </Pill>
        {report.aiPriority && report.aiPriority !== "pending" && (
          <Pill tone={aiPriorityTone(report.aiPriority)}>
            AI:{report.aiPriority}
          </Pill>
        )}
        {(() => {
          const mint = report.onchain?.mint;
          if (!mint || !mint.status || mint.status === "not_started") return null;
          const tone =
            mint.status === "minted"
              ? "ok"
              : mint.status === "failed"
                ? "warn"
                : "warn";
          const networkLabel = mint.network?.startsWith("skale") ? "SKALE" : "BASE";
          const label =
            mint.status === "minted"
              ? `${networkLabel} ✓`
              : mint.status === "queued"
                ? `${networkLabel} queued`
                : mint.status === "minting"
                  ? `${networkLabel} minting…`
                  : mint.status === "failed"
                    ? `${networkLabel} failed`
                    : `${networkLabel} ${mint.status}`;
          return <Pill tone={tone}>{label}</Pill>;
        })()}
        <time
          dateTime={report.createdAt}
          className="ml-auto text-[9px] font-mono text-aeris-muted"
          title={new Date(report.createdAt).toLocaleString()}
        >
          {formatRelativeTime(report.createdAt)}
        </time>
      </header>

      <p className="text-[12px] leading-snug text-aeris-text line-clamp-3">
        {report.description}
      </p>

      {report.aiTriageRationale && (
        <p className="mt-1 text-[10px] text-aeris-muted line-clamp-2">
          AI: {report.aiTriageRationale}
        </p>
      )}

      {report.photoUrl ? (
        <div className="mt-1.5 overflow-hidden rounded border border-aeris-border/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.photoUrl}
            alt="Report photo"
            className="max-h-24 w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-aeris-muted">
        {report.sourceApp && <span>{report.sourceApp}</span>}
        {confidencePct !== null && <span>{confidencePct}% conf</span>}
        {report.confirmations > 0 && (
          <span>{report.confirmations} confirmation{report.confirmations === 1 ? "" : "s"}</span>
        )}
        <span className="inline-flex items-center gap-0.5 text-aeris-accent/80">
          <MapPin size={10} aria-hidden />
          Tap to locate on map
        </span>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setDetailsOpen((open) => !open);
        }}
        className="mt-1 text-[9px] font-mono uppercase tracking-wider text-aeris-muted hover:text-aeris-text"
      >
        {detailsOpen ? "Hide details ▴" : "Details ▾"}
      </button>

      {detailsOpen && (
        <div className="mt-1 space-y-0.5 border-t border-aeris-border/40 pt-1 text-[10px] font-mono text-aeris-muted">
          <div>msg: {report.messageId ?? report.id}</div>
          <div>mint: {report.onchain?.mint.status ?? "not_started"}</div>
          {report.onchain?.mint.txHash && (
            <div className="flex items-center gap-1">
              <span>tx: {report.onchain.mint.txHash.slice(0, 18)}…</span>
              {(() => {
                const network = report.onchain?.mint.network ?? "";
                const tx = report.onchain?.mint.txHash;
                if (!tx) return null;
                const explorerBase =
                  network === "skale-base-mainnet"
                    ? "https://skale-base-explorer.skalenodes.com"
                    : network === "skale-base-testnet"
                      ? "https://base-sepolia-testnet-explorer.skalenodes.com"
                      : network === "base-mainnet"
                        ? "https://basescan.org"
                        : network === "base-sepolia"
                          ? "https://sepolia.basescan.org"
                          : null;
                if (!explorerBase) return null;
                return (
                  <a
                    href={`${explorerBase}/tx/${tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-aeris-accent underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    explorer ↗
                  </a>
                );
              })()}
            </div>
          )}
          {report.onchain?.mint.tokenId && (
            <div>token: {report.onchain.mint.tokenId.slice(0, 14)}…</div>
          )}
          {report.phoneVerificationStatus &&
            report.phoneVerificationStatus !== "unverified" && (
              <div>phone: {report.phoneVerificationStatus}</div>
            )}
        </div>
      )}

      {canReview && (
        <div
          className="mt-2 grid grid-cols-3 gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "verify")}
            className="rounded border border-aeris-ok/30 bg-aeris-ok/10 px-1 py-1 text-[10px] font-mono uppercase text-aeris-ok disabled:opacity-40"
          >
            Verify
          </button>
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "needs_review")}
            className="rounded border border-aeris-warn/30 bg-aeris-warn/10 px-1 py-1 text-[10px] font-mono uppercase text-aeris-warn disabled:opacity-40"
          >
            Review
          </button>
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "reject")}
            className="rounded border border-aeris-danger/30 bg-aeris-danger/10 px-1 py-1 text-[10px] font-mono uppercase text-aeris-danger disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}

export function LiveReportsPanel({
  map,
  embedded,
}: {
  map: MLMap | null;
  /** Omit duplicate chrome when shown inside the header popover. */
  embedded?: boolean;
}) {
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [listExpanded, setListExpanded] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    tone: "ok" | "warn" | "danger";
    msg: string;
  } | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const { role, userId, authDisabled } = useAerisRole();
  const canReview = role === "admin" || authDisabled;

  const urgentReports = useMemo(
    () => reports.filter((report) => report.aiPriority === "urgent"),
    [reports],
  );
  const chatReports = useMemo(
    () => reports.filter((report) => report.sourceApp === "aeris-chat"),
    [reports],
  );
  const unverifiedReports = useMemo(
    () =>
      reports.filter(
        (report) => (report.verificationStatus ?? "unverified") !== "verified",
      ),
    [reports],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReports();
      setReports(sortReports(data));
      setStatus((current) =>
        current?.tone === "danger"
          ? { tone: "ok", msg: "Reports feed recovered." }
          : current,
      );
    } catch (error) {
      setStatus({
        tone: "danger",
        msg: `Reports feed unavailable: ${(error as Error).message}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh.current = () => {
      void load();
    };
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 20 * 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);

  const filteredReports = useMemo(() => {
    const sorted = sortReports(reports);
    if (filter === "urgent") {
      return sorted.filter((report) => report.aiPriority === "urgent");
    }
    if (filter === "unverified") {
      return sorted.filter(
        (report) => (report.verificationStatus ?? "unverified") !== "verified",
      );
    }
    return sorted;
  }, [reports, filter]);

  const focusReport = (report: IncidentReport) => {
    if (!map) return;
    map.flyTo({
      center: report.position,
      zoom: Math.max(map.getZoom(), 13),
      duration: 900,
      essential: true,
    });
  };

  const onReview = async (
    event: React.MouseEvent,
    report: IncidentReport,
    action: ReportReviewAction,
  ) => {
    event.stopPropagation();
    setReviewingId(report.id);
    try {
      await reviewReport({
        reportId: report.id,
        action,
        actorId: userId ?? undefined,
        confidence:
          action === "verify"
            ? Math.max(report.confidence ?? 0, 0.85)
            : action === "reject"
              ? Math.min(report.confidence ?? 0.25, 0.1)
              : report.confidence,
      });
      setStatus({ tone: "ok", msg: `Report marked ${action}.` });
      refresh.current();
      window.dispatchEvent(new CustomEvent("aeris:reports-refresh"));
    } catch (error) {
      setStatus({ tone: "danger", msg: (error as Error).message });
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="space-y-2.5">
      {!embedded && (
        <CardHeader title="Live Reports" />
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {embedded && (
            <Pill tone={canReview ? "ok" : "warn"}>{role}</Pill>
          )}
          <FreshnessTag source="reports" />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1 rounded border border-aeris-border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-aeris-muted hover:bg-aeris-elev/50 hover:text-aeris-text disabled:opacity-50"
          aria-label="Refresh reports"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Sync
        </button>
      </div>

      <div className="rounded-md border border-aeris-danger/45 bg-aeris-danger/10 px-3 py-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-aeris-danger/80">
              Total Reports
            </div>
            <div className="text-2xl font-mono font-semibold tabular-nums leading-none text-aeris-danger">
              {reports.length}
            </div>
          </div>
          {loading && reports.length === 0 ? (
            <span className="text-[10px] font-mono text-aeris-danger/70">Loading…</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <StatChip
          label="Urgent"
          count={urgentReports.length}
          tone="danger"
          active={filter === "urgent"}
          onClick={() =>
            setFilter((current) => (current === "urgent" ? "all" : "urgent"))
          }
        />
        <StatChip
          label="Chat"
          count={chatReports.length}
          active={false}
        />
        <StatChip
          label="Needs Review"
          count={unverifiedReports.length}
          tone="warn"
          active={filter === "unverified"}
          onClick={() =>
            setFilter((current) =>
              current === "unverified" ? "all" : "unverified",
            )
          }
        />
      </div>

      <p className="text-[10px] leading-snug text-aeris-muted">
        Consumer reports are displayed immediately as unverified intelligence
        until corroborated by operators or official sources.
      </p>

      {status && (
        <div
          className={clsx(
            "text-[11px]",
            status.tone === "ok"
              ? "text-aeris-ok"
              : status.tone === "warn"
                ? "text-aeris-warn"
                : "text-aeris-danger",
          )}
        >
          {status.msg}
        </div>
      )}

      <div className="border-t border-aeris-border pt-2">
        <button
          type="button"
          onClick={() => setListExpanded((open) => !open)}
          aria-expanded={listExpanded}
          aria-controls="live-reports-feed"
          className={clsx(
            "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
            listExpanded
              ? "border-aeris-accent/35 bg-aeris-accent/5"
              : "border-aeris-border/60 bg-aeris-bg/40 hover:border-aeris-accent/30 hover:bg-aeris-elev/30",
          )}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-aeris-text">
            Report feed
          </span>
          <span className="text-[10px] font-mono tabular-nums text-aeris-muted">
            {loading && reports.length === 0
              ? "…"
              : `${filteredReports.length} item${filteredReports.length === 1 ? "" : "s"}`}
          </span>
          {urgentReports.length > 0 && !listExpanded && (
            <Pill tone="danger" className="ml-1">
              {urgentReports.length} urgent
            </Pill>
          )}
          <ChevronDown
            size={14}
            aria-hidden
            className={clsx(
              "ml-auto shrink-0 text-aeris-muted transition-transform",
              listExpanded && "rotate-180",
            )}
          />
        </button>

        {listExpanded ? (
          <div
            id="live-reports-feed"
            className="mt-2 space-y-2 max-h-[min(50vh,420px)] overflow-y-auto"
          >
            {loading && reports.length === 0 ? (
              <p className="text-[11px] text-aeris-muted py-4 text-center">
                Fetching reports…
              </p>
            ) : filteredReports.length === 0 ? (
              <p className="text-[11px] text-aeris-muted py-4 text-center">
                {filter === "all"
                  ? "No reports yet."
                  : "No reports match this filter."}
              </p>
            ) : (
              filteredReports.slice(0, 20).map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  canReview={canReview}
                  reviewing={reviewingId === report.id}
                  onFocus={() => focusReport(report)}
                  onReview={(event, action) => onReview(event, report, action)}
                />
              ))
            )}
          </div>
        ) : filteredReports.length > 0 ? (
          <p className="mt-1.5 text-[10px] text-aeris-muted">
            Expand to review individual reports and take action.
          </p>
        ) : null}
      </div>
    </div>
  );
}
