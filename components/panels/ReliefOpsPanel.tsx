"use client";

/**
 * Relief Ops (v1): the Command Board for relief releases that run on ReQuest.
 *
 * Each pickup site is one ReQuest event. With REQUEST_API_KEY set, AERIS reads
 * its pass counts (issued vs. scanned). Without it (link-only mode) the board
 * lists the sites and sends people to each ReQuest event page. Styled with
 * the FLOOD CONTROL by bagyo.app day theme through the shared Kit and
 * `aeris-*` classes, like every other panel.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { Pill } from "@/components/ui/Card";
import { Kicker, SectionLabel } from "@/components/ui/Kit";
import { usePanelHeaderBadge } from "@/components/panel-header-badge";
import { useAerisRole } from "@/services/role-context";
import {
  refreshReliefOps,
  servedRatio,
  useReliefOps,
  type ReliefOperationView,
  type ReliefSiteView,
} from "@/components/relief/relief-store";
import { focusReliefSite, formatPickupWindow } from "@/services/relief-sites-map";
import type { RequestCountsIssue } from "@/lib/request-api";

const ISSUE_LABELS: Record<RequestCountsIssue, string> = {
  not_configured: "ReQuest not connected",
  not_found: "Event not found",
  not_allowlisted: "Not on key allowlist",
  auth: "Key rejected",
  unavailable: "ReQuest unreachable",
};


const INPUT = "aeris-input w-full px-2.5 py-1.5 text-body-sm";

export function ReliefOpsPanel({ map }: { map: MLMap | null }) {
  const { status, data, error } = useReliefOps();
  const { role } = useAerisRole();
  const isAdmin = role === "admin";
  /** No ReQuest key: no counts, the board only links out to ReQuest. */
  const linkOnly = data != null && !data.configured.request;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const operations = data?.operations ?? [];
  const operation =
    operations.find((o) => o.id === selectedId) ?? operations[0] ?? null;
  const served = operation
    ? servedRatio({ issued: operation.totals.issued, claimed: operation.totals.claimed })
    : null;

  const badge = useMemo(
    () =>
      served == null ? null : (
        <Pill tone={served >= 0.9 ? "ok" : "accent"}>{Math.round(served * 100)}%</Pill>
      ),
    [served],
  );
  usePanelHeaderBadge("relief", badge);

  const refresh = async () => {
    setRefreshing(true);
    await refreshReliefOps();
    setRefreshing(false);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Kicker live={status === "ready" && !error && !linkOnly}>
          {linkOnly ? "Relief pickups" : "Live from ReQuest"}
        </Kicker>
        <div className="flex items-center gap-1.5">
          {data?.fetchedAt ? (
            <span className="text-chrome font-bold text-aeris-muted">
              {new Date(data.fetchedAt).toLocaleTimeString("en-PH", {
                timeZone: "Asia/Manila",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          <button
            type="button"
            className="aeris-round !h-7 !min-w-7 !px-0"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh relief operations"
            title="Refresh"
          >
            <RefreshCw size={13} aria-hidden className={clsx(refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {status === "idle" || status === "loading" ? (
        <p className="text-body-sm text-aeris-muted">Loading relief operations…</p>
      ) : null}

      {status === "error" ? (
        <Notice tone="danger" title="Relief data didn't load">
          {error}
        </Notice>
      ) : null}

      {data && !data.configured.store ? (
        <Notice tone="muted" title="Relief Ops isn't set up yet">
          Apply the relief tables migration in Supabase to start tracking releases.
        </Notice>
      ) : null}

      {data?.configured.store && linkOnly && operations.length > 0 ? (
        <Notice tone="muted" title="Claims run in ReQuest">
          Open a pickup site&apos;s ReQuest event to see its schedule, passes, and claim
          status.
        </Notice>
      ) : null}

      {data?.configured.store && operations.length === 0 ? (
        <Notice tone="muted" title="No active relief operation">
          {isAdmin
            ? "LGU coordinators start operations and link pickup sites in AERIS Relief."
            : "An LGU coordinator starts an operation when relief is released."}
        </Notice>
      ) : null}

      {operation ? (
        <>
          {operations.length > 1 ? (
            <label className="block">
              <span className="sr-only">Relief operation</span>
              <select
                className={INPUT}
                value={operation.id}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {linkOnly ? (
            <OperationHeader operation={operation} />
          ) : (
            <OperationSummary operation={operation} served={served} />
          )}
          <SiteList operation={operation} map={map} linkOnly={linkOnly} />
        </>
      ) : null}

      {isAdmin && data?.configured.store ? <ReliefAppLink /> : null}

      {error && status === "ready" ? (
        <p className="text-chrome font-bold text-aeris-warn">Last refresh failed: {error}</p>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "danger" | "warn" | "muted";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="aeris-incident px-3 py-2"
      data-tone={tone === "warn" ? undefined : tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="text-body-sm font-extrabold text-aeris-text">{title}</div>
      <div className="text-body-sm text-aeris-ink2">{children}</div>
    </div>
  );
}

function OperationTitle({ operation }: { operation: ReliefOperationView }) {
  const sub = [operation.lgu, operation.incidentRef].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="aeris-title truncate">{operation.name}</div>
      {sub ? <div className="text-body-sm text-aeris-muted truncate">{sub}</div> : null}
    </div>
  );
}

/** Link-only mode: no counts to summarise, just what the operation is. */
function OperationHeader({ operation }: { operation: ReliefOperationView }) {
  const n = operation.sites.length;
  return (
    <div className="aeris-row space-y-1 p-3">
      <OperationTitle operation={operation} />
      <p className="text-chrome font-bold text-aeris-muted">
        {n} pickup site{n === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function OperationSummary({
  operation,
  served,
}: {
  operation: ReliefOperationView;
  served: number | null;
}) {
  const { issued, claimed, sitesReporting, sitesTotal } = operation.totals;
  const pct = served == null ? null : Math.round(served * 100);

  return (
    <div className="aeris-row space-y-2.5 p-3">
      <OperationTitle operation={operation} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Passes issued" value={issued.toLocaleString()} />
        <Stat label="Released" value={claimed.toLocaleString()} tone="ok" />
        <Stat label="Still to claim" value={Math.max(0, issued - claimed).toLocaleString()} tone="warm" />
        <Stat label="Served" value={pct == null ? "—" : `${pct}%`} tone="accent" />
      </div>
      <ProgressBar ratio={served} label="Households served" />
      {sitesReporting < sitesTotal ? (
        <p className="text-chrome font-bold text-aeris-muted">
          Counts from {sitesReporting} of {sitesTotal} pickup sites.
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warm" | "accent";
}) {
  return (
    <div className="aeris-stat">
      <div
        className={clsx(
          "text-body-lg font-black tabular-nums leading-tight",
          tone === "ok" && "text-aeris-ok",
          tone === "warm" && "text-aeris-warn",
          tone === "accent" && "text-aeris-accent",
          !tone && "text-aeris-text",
        )}
      >
        {value}
      </div>
      <SectionLabel className="!mt-0.5">{label}</SectionLabel>
    </div>
  );
}

function ProgressBar({ ratio, label }: { ratio: number | null; label: string }) {
  const pct = ratio == null ? 0 : Math.round(ratio * 100);
  return (
    <div
      className="aeris-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio == null ? undefined : pct}
    >
      <div
        className={clsx("h-full rounded-full", ratio != null && ratio >= 0.9 ? "bg-aeris-ok" : "bg-cta")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Sites furthest behind first, so laggard pickup points surface at the top.
 * Sites without counts (all of them in link-only mode) follow, earliest
 * pickup first.
 */
function sortSites(sites: ReliefSiteView[]): ReliefSiteView[] {
  const start = (s: ReliefSiteView) => (s.pickupStart ? Date.parse(s.pickupStart) : Infinity);
  return [...sites].sort((a, b) => {
    const ra = servedRatio(a.counts);
    const rb = servedRatio(b.counts);
    if (ra == null && rb == null) {
      return start(a) - start(b) || a.barangay.localeCompare(b.barangay);
    }
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  });
}

function SiteList({
  operation,
  map,
  linkOnly,
}: {
  operation: ReliefOperationView;
  map: MLMap | null;
  linkOnly: boolean;
}) {
  const sites = useMemo(() => sortSites(operation.sites), [operation.sites]);
  if (sites.length === 0) {
    return (
      <p className="text-body-sm text-aeris-muted">
        No pickup sites yet. Link each pickup point&apos;s ReQuest event to track it here.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <SectionLabel as="h3">Pickup sites · {sites.length}</SectionLabel>
      <ul className="space-y-1.5">
        {sites.map((site) => (
          <SiteRow
            key={site.id}
            site={site}
            operationName={operation.name}
            map={map}
            linkOnly={linkOnly}
          />
        ))}
      </ul>
    </div>
  );
}

function SiteRow({
  site,
  operationName,
  map,
  linkOnly,
}: {
  site: ReliefSiteView;
  operationName: string;
  map: MLMap | null;
  linkOnly: boolean;
}) {
  const ratio = servedRatio(site.counts);
  const when = formatPickupWindow(site.pickupStart, site.pickupEnd);
  const detail = [site.pickupPoint, when].filter(Boolean).join(" · ");
  const canFocus = map != null && site.lat != null && site.lon != null;

  return (
    <li className="aeris-row space-y-1.5 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-body-sm font-extrabold text-aeris-text truncate">
            Brgy. {site.barangay}
          </div>
          {detail ? <div className="text-chrome font-bold text-aeris-muted truncate">{detail}</div> : null}
        </div>
        {site.countsIssue && !site.counts ? (
          <Pill tone="warn" className="shrink-0">
            {ISSUE_LABELS[site.countsIssue]}
          </Pill>
        ) : ratio != null ? (
          <Pill tone={ratio >= 0.9 ? "ok" : "accent"} className="shrink-0">
            {Math.round(ratio * 100)}%
          </Pill>
        ) : null}
      </div>
      {site.counts ? (
        <>
          <ProgressBar ratio={ratio} label={`Brgy. ${site.barangay} households served`} />
          <div className="text-chrome font-bold text-aeris-ink2 tabular-nums">
            {site.counts.claimed.toLocaleString()} of {site.counts.issued.toLocaleString()} households
            {site.countsIssue ? <span className="text-aeris-warn"> · stale</span> : null}
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <a
          href={site.requestEventUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx(
            "px-2.5 py-1 text-chrome",
            linkOnly ? "aeris-btn-cta !gap-1.5" : "aeris-btn-soft",
          )}
        >
          <ExternalLink size={12} aria-hidden />
          Open in ReQuest
        </a>
        {canFocus ? (
          <button
            type="button"
            className="aeris-btn-soft px-2.5 py-1 text-chrome"
            onClick={() => map && focusReliefSite(map, { ...site, operationName })}
          >
            <MapPin size={12} aria-hidden />
            Show on map
          </button>
        ) : null}
      </div>
    </li>
  );
}

// ---- admin ---------------------------------------------------------------

/** Where operations are set up now (AERIS Relief); hidden when the URL isn't configured. */
const RELIEF_APP_URL = process.env.NEXT_PUBLIC_RELIEF_APP_URL?.trim().replace(/\/$/, "") ?? "";

function ReliefAppLink() {
  if (!/^https?:\/\//.test(RELIEF_APP_URL)) return null;
  return (
    <a
      href={RELIEF_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="aeris-btn-soft w-full px-2.5 py-1.5 text-chrome"
    >
      <ExternalLink size={12} aria-hidden />
      Set up and manage in AERIS Relief
    </a>
  );
}
