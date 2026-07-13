"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Maximize2,
  MapPin,
  RefreshCw,
  Siren,
  Stamp,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { CardHeader, Pill } from "../ui/Card";
import {
  reviewReport,
  mintVerifiedReports,
  type ReportReviewAction,
  fetchReports,
  fetchMyReportVotes,
  voteOnReport,
  type ReportVoteValue,
  type IncidentReport,
} from "@/services/reports-client";
import { FreshnessTag } from "../ui/FreshnessTag";
import { useAerisRole } from "@/services/role-context";
import { useUserProfile } from "@/services/profile-context";
import { mintExplorerTxUrl, shortTxHash } from "@/lib/onchain/explorer-links";
import { formatAerisRoleLabel, type AerisRole } from "@/lib/aeris-roles";
import { XP_REWARDS } from "@/lib/gamification";

const AI_PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  low_priority: 1,
  pending: 2,
  rejected: 3,
};

type ReportFilter = "all" | "urgent" | "unverified" | "verified" | "minted";
type SortBy = "priority" | "newest" | "oldest";
type DateRange = "all" | "1h" | "24h" | "7d";

/** How many cards render before the "showing N of M" cap kicks in. */
const EMBEDDED_LIMIT = 40;

/** Brief delight beat after a confirmed vote, before the card leaves the feed. */
const VOTE_DELIGHT_MS = 1100;
const FULLSCREEN_LIMIT = 300;

const DATE_RANGE_MS: Record<DateRange, number | null> = {
  all: null,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "all", label: "All" },
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

function isVerifiedReport(report: IncidentReport) {
  return report.verificationStatus === "verified";
}

function isMintedReport(report: IncidentReport) {
  return report.onchain?.mint?.status === "minted";
}

function isPendingMintReport(report: IncidentReport) {
  const status = report.onchain?.mint?.status ?? "not_started";
  return (
    isVerifiedReport(report) &&
    status !== "minted" &&
    status !== "minting"
  );
}

function withinRange(report: IncidentReport, range: DateRange) {
  const windowMs = DATE_RANGE_MS[range];
  if (windowMs == null) return true;
  const ts = new Date(report.createdAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts <= windowMs;
}

function sortReports(reports: IncidentReport[], sortBy: SortBy) {
  const arr = [...reports];
  if (sortBy === "newest") {
    return arr.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  if (sortBy === "oldest") {
    return arr.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
  // priority: urgent first, then most-recent within the same rank.
  return arr.sort((a, b) => {
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

/** Compact segmented toggle used for sort + date-range controls. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-md border border-aeris-border/60 bg-aeris-bg/50 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "rounded px-2 py-1 text-chrome font-mono uppercase tracking-wider transition-colors",
              active
                ? "bg-aeris-accent/15 text-aeris-accent shadow-sm"
                : "text-aeris-muted hover:bg-aeris-elev/50 hover:text-aeris-text",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ReportControls({
  sortBy,
  onSortChange,
  dateRange,
  onRangeChange,
  className,
}: {
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
  dateRange: DateRange;
  onRangeChange: (value: DateRange) => void;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-chrome font-mono uppercase tracking-wider text-aeris-muted/70">
          Sort
        </span>
        <Segmented
          ariaLabel="Sort reports"
          options={SORT_OPTIONS}
          value={sortBy}
          onChange={onSortChange}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Clock size={11} className="text-aeris-muted/70" aria-hidden />
        <span className="text-chrome font-mono uppercase tracking-wider text-aeris-muted/70">
          Range
        </span>
        <Segmented
          ariaLabel="Filter by time range"
          options={RANGE_OPTIONS}
          value={dateRange}
          onChange={onRangeChange}
        />
      </div>
    </div>
  );
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
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={clsx(
        "rounded-md border px-2 py-1 text-left transition-colors",
        toneClass,
        active && "ring-1 ring-aeris-accent/60 bg-aeris-accent/10",
        onClick && "hover:bg-aeris-elev/40 cursor-pointer",
      )}
    >
      <div className="text-chrome font-mono uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-sm font-mono tabular-nums leading-tight">{count}</div>
    </Tag>
  );
}

type FeedCounts = {
  total: number;
  urgent: number;
  chat: number;
  unverified: number;
  verified: number;
  minted: number;
  pendingMint: number;
};

function StatsGrid({
  counts,
  filter,
  onFilter,
  canReview,
  mintingAll,
  onMintAllVerified,
  className,
}: {
  counts: FeedCounts;
  filter: ReportFilter;
  onFilter: (next: ReportFilter) => void;
  canReview: boolean;
  mintingAll: boolean;
  onMintAllVerified: () => void;
  className?: string;
}) {
  const toggle = (value: Exclude<ReportFilter, "all">) =>
    onFilter(filter === value ? "all" : value);

  return (
    <div className={clsx("grid grid-cols-3 gap-1.5", className)}>
      <StatChip
        label="Urgent"
        count={counts.urgent}
        tone="danger"
        active={filter === "urgent"}
        onClick={() => toggle("urgent")}
      />
      <StatChip label="Chat" count={counts.chat} />
      <StatChip
        label="Needs Review"
        count={counts.unverified}
        tone="warn"
        active={filter === "unverified"}
        onClick={() => toggle("unverified")}
      />
      <StatChip
        label="Verified"
        count={counts.verified}
        tone="ok"
        active={filter === "verified"}
        onClick={() => toggle("verified")}
      />
      <StatChip
        label="Minted"
        count={counts.minted}
        tone="ok"
        active={filter === "minted"}
        onClick={() => toggle("minted")}
      />
      {canReview ? (
        <button
          type="button"
          onClick={onMintAllVerified}
          disabled={mintingAll || counts.pendingMint === 0}
          className={clsx(
            "rounded-md border px-2 py-1 text-left transition-colors",
            "border-aeris-accent/35 text-aeris-accent",
            "hover:bg-aeris-accent/10 disabled:cursor-not-allowed disabled:opacity-40",
          )}
          title={
            counts.pendingMint === 0
              ? "All verified reports are minted or in progress"
              : `Queue and mint ${counts.pendingMint} verified report${counts.pendingMint === 1 ? "" : "s"}`
          }
        >
          <div className="flex items-center gap-1 text-chrome font-mono uppercase tracking-wider opacity-80">
            <Stamp size={10} aria-hidden />
            Mint all
          </div>
          <div className="text-sm font-mono tabular-nums leading-tight">
            {mintingAll ? "…" : counts.pendingMint}
          </div>
        </button>
      ) : (
        <StatChip label="Pending Mint" count={counts.pendingMint} tone="warn" />
      )}
    </div>
  );
}

function ReportCard({
  report,
  canReview,
  reviewing,
  canVote,
  myVote,
  voting,
  delight,
  delightAwarded,
  exiting,
  onFocus,
  onReview,
  onVote,
}: {
  report: IncidentReport;
  canReview: boolean;
  reviewing: boolean;
  canVote: boolean;
  myVote?: ReportVoteValue;
  voting: boolean;
  delight: boolean;
  delightAwarded: boolean;
  exiting: boolean;
  onFocus: () => void;
  onReview: (
    event: React.MouseEvent,
    action: ReportReviewAction,
  ) => void;
  onVote: (event: React.MouseEvent, vote: ReportVoteValue) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingVote, setPendingVote] = useState<ReportVoteValue | null>(null);
  const tone = reportCardTone(report);
  const confidencePct =
    typeof report.confidence === "number"
      ? Math.round(report.confidence * 100)
      : null;
  const mintTxHash =
    report.onchain?.mint?.status === "minted"
      ? report.onchain.mint.txHash
      : undefined;
  const mintTxHref = mintTxHash
    ? mintExplorerTxUrl(report.onchain?.mint.network, mintTxHash)
    : null;

  // Drop local confirm state if the parent finishes or abandons this vote.
  useEffect(() => {
    if (!voting && !delight) setPendingVote(null);
  }, [voting, delight]);

  return (
    <article
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onFocus();
      }}
      role="button"
      tabIndex={0}
      className={clsx(
        "flex h-full w-full cursor-pointer flex-col rounded-lg border p-2.5 text-left transition-colors",
        "hover:border-aeris-accent/40 hover:bg-aeris-accent/5",
        "focus:outline-none focus:border-aeris-accent/50 focus:ring-1 focus:ring-aeris-accent/40",
        CARD_TONE_CLASS[tone],
        exiting && "aeris-vote-card-exit",
      )}
    >
      <header className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {report.aiPriority === "urgent" ? (
          <Siren size={13} className="shrink-0 text-aeris-danger" aria-hidden />
        ) : (
          <AlertTriangle size={13} className="shrink-0 text-aeris-warn" aria-hidden />
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
          const mintTone =
            mint.status === "minted" ? "ok" : ("warn" as const);
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
          return <Pill tone={mintTone}>{label}</Pill>;
        })()}
        <time
          dateTime={report.createdAt}
          className="ml-auto text-chrome font-mono text-aeris-muted"
          title={new Date(report.createdAt).toLocaleString()}
        >
          {formatRelativeTime(report.createdAt)}
        </time>
      </header>

      <p className="text-body-sm leading-snug text-aeris-text line-clamp-3">
        {report.description}
      </p>

      {report.aiTriageRationale && (
        <p className="mt-1 text-body-sm text-aeris-muted line-clamp-2">
          AI: {report.aiTriageRationale}
        </p>
      )}

      {report.photoUrl ? (
        <div className="mt-2 overflow-hidden rounded border border-aeris-border/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.photoUrl}
            alt="Report photo"
            className="max-h-28 w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-sm text-aeris-muted">
        {report.sourceApp && <span>{report.sourceApp}</span>}
        {confidencePct !== null && <span>{confidencePct}% conf</span>}
        {report.confirmations > 0 && (
          <span>{report.confirmations} confirmation{report.confirmations === 1 ? "" : "s"}</span>
        )}
        {mintTxHash ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <span>TXN</span>
            {mintTxHref ? (
              <a
                href={mintTxHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-aeris-accent hover:underline"
                title={mintTxHash}
                onClick={(event) => event.stopPropagation()}
              >
                {shortTxHash(mintTxHash)}
              </a>
            ) : (
              <span className="text-aeris-text" title={mintTxHash}>
                {shortTxHash(mintTxHash)}
              </span>
            )}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-body-sm text-aeris-accent/80">
          <MapPin size={11} aria-hidden />
          Locate on map
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDetailsOpen((open) => !open);
          }}
          className="text-chrome font-mono uppercase tracking-wider text-aeris-muted hover:text-aeris-text"
        >
          {detailsOpen ? "Hide details ▴" : "Details ▾"}
        </button>
      </div>

      {detailsOpen && (
        <div className="mt-1.5 space-y-0.5 border-t border-aeris-border/40 pt-1.5 text-body-sm font-mono text-aeris-muted">
          <div>msg: {report.messageId ?? report.id}</div>
          <div>mint: {report.onchain?.mint.status ?? "not_started"}</div>
          {mintTxHash && (
            <div className="flex items-center gap-1">
              <span>tx: {shortTxHash(mintTxHash, 18, 8)}</span>
              {mintTxHref ? (
                <a
                  href={mintTxHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-aeris-accent underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  explorer ↗
                </a>
              ) : null}
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

      {canVote && (
        <ReportVoteControls
          report={report}
          myVote={myVote}
          voting={voting}
          delight={delight}
          delightAwarded={delightAwarded}
          pendingVote={pendingVote}
          onPendingChange={setPendingVote}
          onVote={onVote}
        />
      )}

      {canReview && (
        <div
          className="mt-2.5 grid grid-cols-3 gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "verify")}
            className="rounded-md border border-aeris-ok/30 bg-aeris-ok/10 px-2 py-1.5 text-body-sm font-medium text-aeris-ok transition-colors hover:bg-aeris-ok/20 disabled:opacity-40 min-h-[36px]"
          >
            Verify
          </button>
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "needs_review")}
            className="rounded-md border border-aeris-warn/30 bg-aeris-warn/10 px-2 py-1.5 text-body-sm font-medium text-aeris-warn transition-colors hover:bg-aeris-warn/20 disabled:opacity-40 min-h-[36px]"
          >
            Review
          </button>
          <button
            type="button"
            disabled={reviewing}
            onClick={(event) => onReview(event, "reject")}
            className="rounded-md border border-aeris-danger/30 bg-aeris-danger/10 px-2 py-1.5 text-body-sm font-medium text-aeris-danger transition-colors hover:bg-aeris-danger/20 disabled:opacity-40 min-h-[36px]"
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}

function ReportVoteControls({
  report,
  myVote,
  voting,
  delight,
  delightAwarded,
  pendingVote,
  onPendingChange,
  onVote,
}: {
  report: IncidentReport;
  myVote?: ReportVoteValue;
  voting: boolean;
  delight: boolean;
  delightAwarded: boolean;
  pendingVote: ReportVoteValue | null;
  onPendingChange: (vote: ReportVoteValue | null) => void;
  onVote: (event: React.MouseEvent, vote: ReportVoteValue) => void;
}) {
  const decided =
    report.verificationStatus === "verified" ||
    report.verificationStatus === "rejected";

  if (delight) {
    const down = myVote === "down";
    return (
      <div
        className={clsx(
          "mt-2.5 relative overflow-hidden rounded-md border px-2.5 py-2",
          down
            ? "border-aeris-danger/40 bg-aeris-danger/10"
            : "border-aeris-ok/40 bg-aeris-ok/10",
        )}
        onClick={(event) => event.stopPropagation()}
        role="status"
        aria-live="polite"
      >
        <span
          className={clsx(
            "aeris-vote-delight-spark pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border",
            down ? "border-aeris-danger/50" : "border-aeris-ok/50",
          )}
          aria-hidden
        />
        <div
          className={clsx(
            "relative flex items-center gap-2 text-body-sm",
            down ? "text-aeris-danger" : "text-aeris-ok",
          )}
        >
          <span
            className={clsx(
              "aeris-vote-delight-icon inline-flex h-6 w-6 items-center justify-center rounded-full",
              down ? "bg-aeris-danger/20" : "bg-aeris-ok/20",
            )}
          >
            {down ? (
              <ThumbsDown size={13} aria-hidden />
            ) : (
              <Check size={14} strokeWidth={2.5} aria-hidden />
            )}
          </span>
          <span className="font-medium">
            {down ? "Doubt recorded" : "Vote recorded"}
          </span>
          {delightAwarded ? (
            <span className="ml-auto font-mono text-chrome tabular-nums">
              +{XP_REWARDS.vote_report} XP
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (decided) {
    if (!myVote) return null;
    const correct =
      (report.verificationStatus === "verified") === (myVote === "up");
    return (
      <div
        className={clsx(
          "mt-2.5 flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-body-sm",
          correct
            ? "border-aeris-ok/30 bg-aeris-ok/10 text-aeris-ok"
            : "border-aeris-border/60 bg-aeris-bg/40 text-aeris-muted",
        )}
      >
        {myVote === "up" ? (
          <ThumbsUp size={12} aria-hidden />
        ) : (
          <ThumbsDown size={12} aria-hidden />
        )}
        {correct
          ? `Your vote was correct — +${XP_REWARDS.vote_correct} XP`
          : "Your vote didn't match the operator decision."}
      </div>
    );
  }

  if (pendingVote) {
    const isUp = pendingVote === "up";
    return (
      <div
        className="mt-2.5 rounded-md border border-aeris-border/70 bg-aeris-bg/40 px-2 py-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        role="group"
        aria-label="Confirm report vote"
      >
        <p className="text-body-sm leading-snug text-aeris-text">
          {isUp
            ? "Mark this report as legitimate?"
            : "Mark this report as doubtful?"}
        </p>
        <p className="mt-0.5 text-chrome text-aeris-muted">
          Are you sure? Your vote helps train triage — you can&apos;t undo it
          from this feed.
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={voting}
            onClick={(event) => onVote(event, pendingVote)}
            className={clsx(
              "inline-flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-body-sm font-medium transition-colors disabled:opacity-40",
              isUp
                ? "border-aeris-ok/50 bg-aeris-ok/15 text-aeris-ok hover:bg-aeris-ok/25"
                : "border-aeris-danger/50 bg-aeris-danger/15 text-aeris-danger hover:bg-aeris-danger/25",
            )}
          >
            {voting ? "Saving…" : "Yes"}
          </button>
          <button
            type="button"
            disabled={voting}
            onClick={(event) => {
              event.stopPropagation();
              onPendingChange(null);
            }}
            className="inline-flex min-h-[28px] flex-1 items-center justify-center rounded border border-aeris-border px-2 py-1 text-body-sm font-medium text-aeris-muted transition-colors hover:bg-aeris-elev/60 hover:text-aeris-text disabled:opacity-40"
          >
            No
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 flex items-center justify-end gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="group"
      aria-label="Vote on report"
    >
      <button
        type="button"
        disabled={voting}
        aria-pressed={myVote === "up"}
        onClick={(event) => {
          event.stopPropagation();
          onPendingChange("up");
        }}
        title={`Looks legitimate — correct votes earn +${XP_REWARDS.vote_correct} XP when an operator verifies`}
        className={clsx(
          "inline-flex h-7 items-center gap-1 rounded border px-2 text-chrome font-medium transition-colors disabled:opacity-40",
          myVote === "up"
            ? "border-aeris-ok/60 bg-aeris-ok/20 text-aeris-ok"
            : "border-aeris-border/70 bg-aeris-bg/30 text-aeris-muted hover:border-aeris-ok/40 hover:bg-aeris-ok/10 hover:text-aeris-ok",
        )}
      >
        <ThumbsUp size={12} aria-hidden />
        Vote Up
      </button>
      <button
        type="button"
        disabled={voting}
        aria-pressed={myVote === "down"}
        onClick={(event) => {
          event.stopPropagation();
          onPendingChange("down");
        }}
        title={`Looks wrong or spam — correct votes earn +${XP_REWARDS.vote_correct} XP when an operator rejects`}
        className={clsx(
          "inline-flex h-7 items-center gap-1 rounded border px-2 text-chrome font-medium transition-colors disabled:opacity-40",
          myVote === "down"
            ? "border-aeris-danger/60 bg-aeris-danger/20 text-aeris-danger"
            : "border-aeris-border/70 bg-aeris-bg/30 text-aeris-muted hover:border-aeris-danger/40 hover:bg-aeris-danger/10 hover:text-aeris-danger",
        )}
      >
        <ThumbsDown size={12} aria-hidden />
        Vote Down
      </button>
    </div>
  );
}

function FeedList({
  id,
  reports,
  layout,
  maxItems,
  loading,
  filter,
  canReview,
  reviewingId,
  canVote,
  myVotes,
  votingId,
  delightId,
  delightAwarded,
  exitingId,
  onFocus,
  onReview,
  onVote,
  emptyMessage,
  className,
}: {
  id?: string;
  reports: IncidentReport[];
  layout: "list" | "grid";
  maxItems: number;
  loading: boolean;
  filter: ReportFilter;
  canReview: boolean;
  reviewingId: string | null;
  canVote: boolean;
  myVotes: Record<string, ReportVoteValue>;
  votingId: string | null;
  delightId: string | null;
  delightAwarded: boolean;
  exitingId: string | null;
  onFocus: (report: IncidentReport) => void;
  onReview: (
    event: React.MouseEvent,
    report: IncidentReport,
    action: ReportReviewAction,
  ) => void;
  onVote: (
    event: React.MouseEvent,
    report: IncidentReport,
    vote: ReportVoteValue,
  ) => void;
  emptyMessage?: string;
  className?: string;
}) {
  const shown = reports.slice(0, maxItems);

  if (loading && reports.length === 0) {
    return (
      <p id={id} className="text-body-sm text-aeris-muted py-6 text-center">
        Fetching reports…
      </p>
    );
  }
  if (reports.length === 0) {
    return (
      <p id={id} className="text-body-sm text-aeris-muted py-6 text-center">
        {emptyMessage ??
          (filter === "all"
            ? "No reports match the current time range."
            : "No reports match this filter.")}
      </p>
    );
  }

  return (
    <div id={id} className={className}>
      <div
        className={clsx(
          layout === "grid"
            ? "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            : "space-y-2",
        )}
      >
        {shown.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            canReview={canReview}
            reviewing={reviewingId === report.id}
            canVote={canVote}
            myVote={myVotes[report.id]}
            voting={votingId === report.id}
            delight={delightId === report.id}
            delightAwarded={delightId === report.id && delightAwarded}
            exiting={exitingId === report.id}
            onFocus={() => onFocus(report)}
            onReview={(event, action) => onReview(event, report, action)}
            onVote={(event, vote) => onVote(event, report, vote)}
          />
        ))}
      </div>
      {reports.length > shown.length && (
        <p className="mt-2 text-center text-chrome font-mono uppercase tracking-wider text-aeris-muted/70">
          Showing {shown.length} of {reports.length} — narrow the range or filter to see more
        </p>
      )}
    </div>
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
  const [sortBy, setSortBy] = useState<SortBy>("priority");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [listExpanded, setListExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [mintingAll, setMintingAll] = useState(false);
  const [myVotes, setMyVotes] = useState<Record<string, ReportVoteValue>>({});
  const [votingId, setVotingId] = useState<string | null>(null);
  const [delightId, setDelightId] = useState<string | null>(null);
  const [delightAwarded, setDelightAwarded] = useState(false);
  const [exitingId, setExitingId] = useState<string | null>(null);
  /** Voted reports hidden from the voter feed (hydrated + after delight). */
  const [dismissedVoteIds, setDismissedVoteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const voteDismissTimers = useRef<{
    exit?: ReturnType<typeof setTimeout>;
    done?: ReturnType<typeof setTimeout>;
  }>({});
  const [status, setStatus] = useState<{
    tone: "ok" | "warn" | "danger";
    msg: string;
  } | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const { role, userId, authDisabled } = useAerisRole();
  const { refresh: refreshProfile } = useUserProfile();
  const canReview = role === "admin" || authDisabled;
  // RLHF voting is for signed-in non-admin users; admins decide via review.
  const canVote = !canReview && Boolean(userId);

  const counts: FeedCounts = useMemo(
    () => ({
      total: reports.length,
      urgent: reports.filter((r) => r.aiPriority === "urgent").length,
      chat: reports.filter((r) => r.sourceApp === "aeris-chat").length,
      unverified: reports.filter(
        (r) => (r.verificationStatus ?? "unverified") !== "verified",
      ).length,
      verified: reports.filter(isVerifiedReport).length,
      minted: reports.filter(isMintedReport).length,
      pendingMint: reports.filter(isPendingMintReport).length,
    }),
    [reports],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReports();
      setReports(data);
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
    // ReportPingsSync (mounted at page level) is the single canonical poller;
    // it broadcasts the full feed on `aeris:reports-updated`. Subscribe to that
    // instead of running our own 20s timer so the feed isn't fetched twice.
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ reports?: IncidentReport[] }>)
        .detail;
      if (!Array.isArray(detail?.reports)) return;
      setReports(detail.reports);
      setStatus((current) =>
        current?.tone === "danger"
          ? { tone: "ok", msg: "Reports feed recovered." }
          : current,
      );
    };
    window.addEventListener("aeris:reports-updated", onUpdate);
    // Populate immediately on mount in case the canonical poller's first
    // broadcast already fired before this panel subscribed.
    void load();
    return () => {
      window.removeEventListener("aeris:reports-updated", onUpdate);
    };
  }, [load]);

  // Hydrate the user's existing votes so cards reflect prior thumbs-up/down.
  // Already-voted reports are dismissed from the voter feed immediately.
  useEffect(() => {
    if (!canVote) return;
    let cancelled = false;
    void fetchMyReportVotes().then((votes) => {
      if (cancelled) return;
      setMyVotes(votes);
      setDismissedVoteIds((current) => {
        const next = new Set(current);
        for (const id of Object.keys(votes)) next.add(id);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [canVote]);

  useEffect(() => {
    const timers = voteDismissTimers.current;
    return () => {
      if (timers.exit) clearTimeout(timers.exit);
      if (timers.done) clearTimeout(timers.done);
    };
  }, []);

  const onVote = useCallback(
    async (
      event: React.MouseEvent,
      report: IncidentReport,
      vote: ReportVoteValue,
    ) => {
      event.stopPropagation();
      if (votingId || delightId) return;
      if (myVotes[report.id] === vote) return;
      setVotingId(report.id);
      const previous = myVotes[report.id];
      setMyVotes((current) => ({ ...current, [report.id]: vote }));
      try {
        const result = await voteOnReport(report.id, vote);
        setStatus({
          tone: "ok",
          msg: result.awarded
            ? `Vote recorded — +${XP_REWARDS.vote_report} XP! Earn +${XP_REWARDS.vote_correct} more if operators agree.`
            : "Vote updated.",
        });
        if (result.awarded) void refreshProfile();
        setVotingId(null);
        setDelightId(report.id);
        setDelightAwarded(result.awarded);

        const timers = voteDismissTimers.current;
        if (timers.exit) clearTimeout(timers.exit);
        if (timers.done) clearTimeout(timers.done);
        const exitAt = Math.max(0, VOTE_DELIGHT_MS - 340);
        timers.exit = setTimeout(() => {
          setExitingId(report.id);
        }, exitAt);
        timers.done = setTimeout(() => {
          setDismissedVoteIds((current) => {
            const next = new Set(current);
            next.add(report.id);
            return next;
          });
          setDelightId((current) => (current === report.id ? null : current));
          setExitingId((current) => (current === report.id ? null : current));
          setDelightAwarded(false);
        }, VOTE_DELIGHT_MS);
      } catch (error) {
        setMyVotes((current) => {
          const next = { ...current };
          if (previous) next[report.id] = previous;
          else delete next[report.id];
          return next;
        });
        setStatus({ tone: "danger", msg: (error as Error).message });
        setVotingId(null);
      }
    },
    [delightId, myVotes, refreshProfile, votingId],
  );

  const visibleReports = useMemo(() => {
    let list = reports;
    if (filter === "urgent") {
      list = list.filter((r) => r.aiPriority === "urgent");
    } else if (filter === "unverified") {
      list = list.filter(
        (r) => (r.verificationStatus ?? "unverified") !== "verified",
      );
    } else if (filter === "verified") {
      list = list.filter(isVerifiedReport);
    } else if (filter === "minted") {
      list = list.filter(isMintedReport);
    }
    list = list.filter((r) => withinRange(r, dateRange));
    // Voters only see reports they haven't confirmed a vote on yet; the next
    // sorted item naturally fills the vacated card slot.
    if (canVote && dismissedVoteIds.size > 0) {
      list = list.filter((r) => !dismissedVoteIds.has(r.id));
    }
    return sortReports(list, sortBy);
  }, [reports, filter, dateRange, sortBy, canVote, dismissedVoteIds]);

  const voteQueueEmptyMessage =
    canVote && dismissedVoteIds.size > 0
      ? "You're caught up — no reports left to vote on."
      : undefined;

  const focusReport = useCallback(
    (report: IncidentReport) => {
      if (!map) return;
      // Close the fullscreen modal so the map (behind it) is visible.
      setFullscreen(false);
      map.flyTo({
        center: report.position,
        zoom: Math.max(map.getZoom(), 13),
        duration: 900,
        essential: true,
      });
    },
    [map],
  );

  const onMintAllVerified = useCallback(async () => {
    setMintingAll(true);
    try {
      const summary = await mintVerifiedReports({ limit: 20 });
      const msg =
        summary.minted > 0
          ? `Minted ${summary.minted} report${summary.minted === 1 ? "" : "s"}.`
          : summary.newlyQueued > 0
            ? `Queued ${summary.newlyQueued} report${summary.newlyQueued === 1 ? "" : "s"} for mint.`
            : "No verified reports pending mint.";
      setStatus({
        tone: summary.failed > 0 ? "warn" : "ok",
        msg:
          summary.failed > 0
            ? `${msg} ${summary.failed} failed.`
            : summary.reachedDeadline && summary.pendingAfter > 0
              ? `${msg} ${summary.pendingAfter} still pending — run again.`
              : msg,
      });
      refresh.current();
      window.dispatchEvent(new CustomEvent("aeris:reports-refresh"));
    } catch (error) {
      setStatus({ tone: "danger", msg: (error as Error).message });
    } finally {
      setMintingAll(false);
    }
  }, []);

  const onReview = useCallback(
    async (
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
    },
    [userId],
  );

  const statusBanner = status ? (
    <div
      className={clsx(
        "rounded-md border px-2.5 py-1.5 text-body-sm",
        status.tone === "ok"
          ? "border-aeris-ok/30 bg-aeris-ok/10 text-aeris-ok"
          : status.tone === "warn"
            ? "border-aeris-warn/30 bg-aeris-warn/10 text-aeris-warn"
            : "border-aeris-danger/30 bg-aeris-danger/10 text-aeris-danger",
      )}
    >
      {status.msg}
    </div>
  ) : null;

  return (
    <div className="space-y-2.5">
      {!embedded && <CardHeader title="Live Reports" helpId="panel.reports" />}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {embedded && (
            <Pill tone={canReview ? "ok" : "warn"}>{formatAerisRoleLabel(role)}</Pill>
          )}
          <FreshnessTag source="reports" />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="inline-flex items-center gap-1 rounded border border-aeris-border px-1.5 py-0.5 text-chrome font-mono uppercase tracking-wider text-aeris-muted hover:bg-aeris-elev/50 hover:text-aeris-text"
            aria-label="Open reports in full screen"
            title="Full screen"
          >
            <Maximize2 size={10} />
            Expand
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded border border-aeris-border px-1.5 py-0.5 text-chrome font-mono uppercase tracking-wider text-aeris-muted hover:bg-aeris-elev/50 hover:text-aeris-text disabled:opacity-50"
            aria-label="Sync reports"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            Sync
          </button>
        </div>
      </div>

      <div className="rounded-md border border-aeris-danger/45 bg-aeris-danger/10 px-3 py-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-chrome font-mono uppercase tracking-wider text-aeris-danger/80">
              Total Reports
            </div>
            <div className="text-2xl font-mono font-semibold tabular-nums leading-none text-aeris-danger">
              {counts.total}
            </div>
          </div>
          {loading && reports.length === 0 ? (
            <span className="text-body-sm font-mono text-aeris-danger/70">Loading…</span>
          ) : null}
        </div>
      </div>

      <StatsGrid
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        canReview={canReview}
        mintingAll={mintingAll}
        onMintAllVerified={() => void onMintAllVerified()}
      />

      <ReportControls
        sortBy={sortBy}
        onSortChange={setSortBy}
        dateRange={dateRange}
        onRangeChange={setDateRange}
      />

      <p className="text-body-sm leading-snug text-aeris-muted">
        Consumer reports are displayed immediately as unverified intelligence
        until corroborated by operators or official sources.
      </p>

      {statusBanner}

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
          <span className="text-body-sm font-mono uppercase tracking-wider text-aeris-text">
            Report feed
          </span>
          <span className="text-body-sm font-mono tabular-nums text-aeris-muted">
            {loading && reports.length === 0
              ? "…"
              : `${visibleReports.length} item${visibleReports.length === 1 ? "" : "s"}`}
          </span>
          {counts.urgent > 0 && !listExpanded && (
            <Pill tone="danger" className="ml-1">
              {counts.urgent} urgent
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
          <FeedList
            id="live-reports-feed"
            reports={visibleReports}
            layout="list"
            maxItems={EMBEDDED_LIMIT}
            loading={loading}
            filter={filter}
            canReview={canReview}
            reviewingId={reviewingId}
            canVote={canVote}
            myVotes={myVotes}
            votingId={votingId}
            delightId={delightId}
            delightAwarded={delightAwarded}
            exitingId={exitingId}
            onFocus={focusReport}
            onReview={onReview}
            onVote={onVote}
            emptyMessage={voteQueueEmptyMessage}
            className="mt-2 max-h-[min(60vh,560px)] overflow-y-auto pr-0.5"
          />
        ) : visibleReports.length > 0 ? (
          <p className="mt-1.5 text-body-sm text-aeris-muted">
            Expand to review individual reports, or open full screen for the grid view.
          </p>
        ) : null}
      </div>

      {fullscreen ? (
        <ReportsFullscreen
          onClose={() => setFullscreen(false)}
          onSync={() => void load()}
          loading={loading}
          role={role}
          canReview={canReview}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
          dateRange={dateRange}
          onRangeChange={setDateRange}
          mintingAll={mintingAll}
          onMintAllVerified={() => void onMintAllVerified()}
          statusBanner={statusBanner}
          reports={visibleReports}
          reviewingId={reviewingId}
          canVote={canVote}
          myVotes={myVotes}
          votingId={votingId}
          delightId={delightId}
          delightAwarded={delightAwarded}
          exitingId={exitingId}
          emptyMessage={voteQueueEmptyMessage}
          onFocus={focusReport}
          onReview={onReview}
          onVote={onVote}
        />
      ) : null}
    </div>
  );
}

function ReportsFullscreen({
  onClose,
  onSync,
  loading,
  role,
  canReview,
  counts,
  filter,
  onFilter,
  sortBy,
  onSortChange,
  dateRange,
  onRangeChange,
  mintingAll,
  onMintAllVerified,
  statusBanner,
  reports,
  reviewingId,
  canVote,
  myVotes,
  votingId,
  delightId,
  delightAwarded,
  exitingId,
  emptyMessage,
  onFocus,
  onReview,
  onVote,
}: {
  onClose: () => void;
  onSync: () => void;
  loading: boolean;
  role: AerisRole;
  canReview: boolean;
  counts: FeedCounts;
  filter: ReportFilter;
  onFilter: (next: ReportFilter) => void;
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
  dateRange: DateRange;
  onRangeChange: (value: DateRange) => void;
  mintingAll: boolean;
  onMintAllVerified: () => void;
  statusBanner: React.ReactNode;
  reports: IncidentReport[];
  reviewingId: string | null;
  canVote: boolean;
  myVotes: Record<string, ReportVoteValue>;
  votingId: string | null;
  delightId: string | null;
  delightAwarded: boolean;
  exitingId: string | null;
  emptyMessage?: string;
  onFocus: (report: IncidentReport) => void;
  onReview: (
    event: React.MouseEvent,
    report: IncidentReport,
    action: ReportReviewAction,
  ) => void;
  onVote: (
    event: React.MouseEvent,
    report: IncidentReport,
    vote: ReportVoteValue,
  ) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  // Portalled to <body> so this modal escapes ancestor stacking contexts
  // (e.g. the sidebar's `backdrop-blur`), matching the PdfOverlay pattern.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-aeris-bg/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Live reports — full screen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden p-3 sm:p-4">
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-aeris-border bg-aeris-surface shadow-2xl">
          {/* Header */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-aeris-border bg-aeris-elev/50 px-3 py-2.5 sm:px-4">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-aeris-accent" />
            <span className="text-body-sm font-semibold text-aeris-text">
              Live Reports
            </span>
            <Pill tone={canReview ? "ok" : "warn"}>{formatAerisRoleLabel(role)}</Pill>
            <FreshnessTag source="reports" />
            <span className="text-body-sm font-mono tabular-nums text-aeris-muted">
              {counts.total} total
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={onSync}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded border border-aeris-border px-2 py-1 text-body-sm font-mono text-aeris-muted transition-colors hover:bg-aeris-elev/50 hover:text-aeris-text disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                Sync
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded border border-aeris-border px-2 py-1 text-body-sm font-mono text-aeris-muted transition-colors hover:border-aeris-danger/60 hover:bg-aeris-danger/5 hover:text-aeris-danger"
                title="Close (Esc)"
                aria-label="Close full screen"
              >
                <X size={12} /> Close
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="shrink-0 space-y-2.5 border-b border-aeris-border/60 bg-aeris-bg/30 px-3 py-2.5 sm:px-4">
            <StatsGrid
              counts={counts}
              filter={filter}
              onFilter={onFilter}
              canReview={canReview}
              mintingAll={mintingAll}
              onMintAllVerified={onMintAllVerified}
              className="sm:grid-cols-6"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ReportControls
                sortBy={sortBy}
                onSortChange={onSortChange}
                dateRange={dateRange}
                onRangeChange={onRangeChange}
              />
              <span className="text-body-sm font-mono tabular-nums text-aeris-muted">
                {reports.length} item{reports.length === 1 ? "" : "s"}
              </span>
            </div>
            {statusBanner}
          </div>

          {/* Feed grid */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            <FeedList
              reports={reports}
              layout="grid"
              maxItems={FULLSCREEN_LIMIT}
              loading={loading}
              filter={filter}
              canReview={canReview}
              reviewingId={reviewingId}
              canVote={canVote}
              myVotes={myVotes}
              votingId={votingId}
              delightId={delightId}
              delightAwarded={delightAwarded}
              exitingId={exitingId}
              emptyMessage={emptyMessage}
              onFocus={onFocus}
              onReview={onReview}
              onVote={onVote}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
