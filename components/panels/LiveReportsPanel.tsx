"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  submitReport,
  reviewReport,
  type ReportReviewAction,
  fetchReports,
  renderReportsOnMap,
  clearReportsFromMap,
  type IncidentReport,
} from "@/services/reports-client";
import { PH_BBOX } from "@/config/region";
import { FreshnessTag } from "../ui/FreshnessTag";

type ComposerState = {
  category: ReportCategory;
  description: string;
  lng: string;
  lat: string;
  photoUrl: string;
};

const EMPTY_COMPOSER: ComposerState = {
  category: "flood",
  description: "",
  lng: "",
  lat: "",
  photoUrl: "",
};

export function LiveReportsPanel({ map }: { map: MLMap | null }) {
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    tone: "ok" | "warn" | "danger";
    msg: string;
  } | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  const chatReports = reports.filter((report) => report.sourceApp === "aeris-chat");
  const unverifiedReports = reports.filter(
    (report) => (report.verificationStatus ?? "unverified") !== "verified",
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchReports();
        if (!cancelled) {
          setReports(data);
          setStatus((current) =>
            current?.tone === "danger"
              ? { tone: "ok", msg: "Reports feed recovered." }
              : current,
          );
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            tone: "danger",
            msg: `Reports feed unavailable: ${(error as Error).message}`,
          });
        }
      }
    };
    refresh.current = run;
    run();
    const id = window.setInterval(run, 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    renderReportsOnMap(map, reports);
    return () => clearReportsFromMap(map);
  }, [map, reports]);

  useEffect(() => {
    if (!map || !picking) return;
    const prevCursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = "crosshair";
    const onClick = (e: maplibregl.MapMouseEvent) => {
      setComposer((c) => ({
        ...c,
        lng: e.lngLat.lng.toFixed(5),
        lat: e.lngLat.lat.toFixed(5),
      }));
      setPicking(false);
    };
    map.once("click", onClick);
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = prevCursor;
    };
  }, [map, picking]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lng = Number(composer.lng);
    const lat = Number(composer.lat);
    if (
      !composer.description.trim() ||
      Number.isNaN(lng) ||
      Number.isNaN(lat)
    ) {
      setStatus({ tone: "warn", msg: "Location and description required." });
      return;
    }
    if (
      lng < PH_BBOX[0] ||
      lng > PH_BBOX[2] ||
      lat < PH_BBOX[1] ||
      lat > PH_BBOX[3]
    ) {
      setStatus({ tone: "warn", msg: "Location must be within the Philippines." });
      return;
    }
    setSubmitting(true);
    try {
      await submitReport({
        category: composer.category,
        description: composer.description,
        position: [lng, lat],
        photoUrl: composer.photoUrl || undefined,
      });
      setStatus({ tone: "ok", msg: "Report submitted. Thank you." });
      setComposer(EMPTY_COMPOSER);
      refresh.current();
    } catch (err) {
      setStatus({ tone: "danger", msg: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

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
        confidence:
          action === "verify"
            ? Math.max(report.confidence ?? 0, 0.85)
            : action === "reject"
              ? Math.min(report.confidence ?? 0.25, 0.1)
              : report.confidence,
      });
      setStatus({ tone: "ok", msg: `Report marked ${action}.` });
      refresh.current();
    } catch (error) {
      setStatus({ tone: "danger", msg: (error as Error).message });
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <CardHeader
        title="Live Reports"
        trailing={<Pill tone="warn">{reports.length} unverified feed</Pill>}
      />
      <FreshnessTag source="reports" />
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="rounded border border-aeris-border/60 px-1.5 py-1">
          <div className="text-aeris-muted font-mono uppercase">Total</div>
          <div className="text-aeris-text font-mono">{reports.length}</div>
        </div>
        <div className="rounded border border-aeris-border/60 px-1.5 py-1">
          <div className="text-aeris-muted font-mono uppercase">Chat</div>
          <div className="text-aeris-text font-mono">{chatReports.length}</div>
        </div>
        <div className="rounded border border-aeris-warn/30 bg-aeris-warn/5 px-1.5 py-1">
          <div className="text-aeris-warn font-mono uppercase">Needs Review</div>
          <div className="text-aeris-warn font-mono">{unverifiedReports.length}</div>
        </div>
      </div>
      <div className="text-[10px] text-aeris-muted">
        Consumer reports are displayed immediately as unverified intelligence
        until corroborated by operators or official sources.
      </div>

      <form onSubmit={onSubmit} className="space-y-1.5 text-xs">
        <div className="grid grid-cols-2 gap-1">
          <select
            value={composer.category}
            onChange={(e) =>
              setComposer({
                ...composer,
                category: e.target.value as ReportCategory,
              })
            }
            className="bg-aeris-bg border border-aeris-border rounded px-1.5 py-1"
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={!map}
            className={`rounded border px-2 py-1 ${
              picking
                ? "bg-aeris-accent/10 text-aeris-accent border-aeris-accent/30"
                : "border-aeris-border text-aeris-muted hover:text-aeris-text"
            }`}
          >
            {picking ? "Click map…" : composer.lng ? "Pick again" : "Pick location"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Longitude"
            value={composer.lng}
            onChange={(e) =>
              setComposer({ ...composer, lng: e.target.value })
            }
            className="bg-aeris-bg border border-aeris-border rounded px-1.5 py-1"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Latitude"
            value={composer.lat}
            onChange={(e) =>
              setComposer({ ...composer, lat: e.target.value })
            }
            className="bg-aeris-bg border border-aeris-border rounded px-1.5 py-1"
          />
        </div>
        <textarea
          placeholder="Describe the situation (max 280 chars)…"
          maxLength={280}
          value={composer.description}
          onChange={(e) =>
            setComposer({ ...composer, description: e.target.value })
          }
          className="w-full bg-aeris-bg border border-aeris-border rounded px-1.5 py-1 resize-none h-16"
        />
        <input
          type="url"
          placeholder="Photo URL (optional)"
          value={composer.photoUrl}
          onChange={(e) =>
            setComposer({ ...composer, photoUrl: e.target.value })
          }
          className="w-full bg-aeris-bg border border-aeris-border rounded px-1.5 py-1"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-2 py-1.5 rounded bg-aeris-accent/10 border border-aeris-accent/40 text-aeris-accent hover:bg-aeris-accent/20 disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        {status && (
          <div
            className={`text-[11px] ${
              status.tone === "ok"
                ? "text-aeris-ok"
                : status.tone === "warn"
                  ? "text-aeris-warn"
                  : "text-aeris-danger"
            }`}
          >
            {status.msg}
          </div>
        )}
      </form>

      <div className="border-t border-aeris-border pt-2 space-y-1.5 max-h-[200px] overflow-y-auto">
        {reports.length === 0 ? (
          <div className="text-[11px] text-aeris-muted">No reports yet.</div>
        ) : (
          reports.slice(0, 20).map((r) => (
            <div
              key={r.id}
              onClick={() => focusReport(r)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") focusReport(r);
              }}
              role="button"
              tabIndex={0}
              className="w-full cursor-pointer text-left text-[11px] p-1.5 rounded border border-aeris-border/60 hover:border-aeris-accent/40 hover:bg-aeris-accent/5 focus:outline-none focus:border-aeris-accent/50"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <Pill tone="warn">{r.category}</Pill>
                <Pill tone={r.verificationStatus === "verified" ? "ok" : "warn"}>
                  {r.verificationStatus ?? "unverified"}
                </Pill>
                {r.onchain?.mint.txHash && (
                  <Pill tone="ok">BASE TX</Pill>
                )}
                <span className="text-aeris-muted font-mono">
                  {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-[10px] text-aeris-muted font-mono mb-0.5">
                msg: {r.messageId ?? r.id}
              </div>
              {r.sourceApp && (
                <div className="text-[10px] text-aeris-muted font-mono mb-0.5">
                  source: {r.sourceApp}
                  {typeof r.confidence === "number"
                    ? ` · confidence ${Math.round(r.confidence * 100)}%`
                    : ""}
                </div>
              )}
              <div className="text-[10px] text-aeris-muted font-mono mb-0.5">
                mint: {r.onchain?.mint.status ?? "not_started"}
                {r.onchain?.mint.txHash ? ` · ${r.onchain.mint.txHash.slice(0, 10)}...` : ""}
              </div>
              <div className="text-aeris-text line-clamp-2">{r.description}</div>
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  disabled={reviewingId === r.id}
                  onClick={(event) => onReview(event, r, "verify")}
                  className="rounded border border-aeris-ok/30 bg-aeris-ok/10 px-1 py-0.5 text-[10px] font-mono uppercase text-aeris-ok disabled:opacity-40"
                >
                  Verify
                </button>
                <button
                  type="button"
                  disabled={reviewingId === r.id}
                  onClick={(event) => onReview(event, r, "needs_review")}
                  className="rounded border border-aeris-warn/30 bg-aeris-warn/10 px-1 py-0.5 text-[10px] font-mono uppercase text-aeris-warn disabled:opacity-40"
                >
                  Review
                </button>
                <button
                  type="button"
                  disabled={reviewingId === r.id}
                  onClick={(event) => onReview(event, r, "reject")}
                  className="rounded border border-aeris-danger/30 bg-aeris-danger/10 px-1 py-0.5 text-[10px] font-mono uppercase text-aeris-danger disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
