import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import { escapeHtml } from "@/lib/sanitize";

// WeakMap-keyed by map so each map instance tracks only its own popup,
// avoiding state leakage between separate maps (e.g. in Storybook or tests).
const activePopups = new WeakMap<MLMap, Popup>();

/**
 * Register a click handler that shows hazard information when the user
 * clicks anywhere on the map. Uses queryRenderedFeatures to gather hazard
 * and report metadata at the click point.
 *
 * Returns a disposer — call it on map unmount to avoid stacking handlers
 * across remounts.
 */
export function registerHazardPopup(map: MLMap): () => void {
  const onClick = (e: maplibregl.MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ["lyr-reports", "lyr-barangay"].filter((l) => map.getLayer(l)),
    });

    const reportFeat = features.find((f) => f.layer.id === "lyr-reports");
    const barangayFeat = features.find((f) => f.layer.id === "lyr-barangay");

    if (!reportFeat && !barangayFeat) return;

    const existing = activePopups.get(map);
    if (existing) existing.remove();

    const html = buildPopupHtml({
      lng: e.lngLat.lng,
      lat: e.lngLat.lat,
      report: reportFeat?.properties as Record<string, unknown> | undefined,
      barangay: barangayFeat?.properties as Record<string, unknown> | undefined,
    });

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "280px",
      className: "aeris-popup",
    })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
    activePopups.set(map, popup);
  };
  map.on("click", onClick);
  const dispose = () => {
    map.off("click", onClick);
    const popup = activePopups.get(map);
    if (popup) {
      popup.remove();
      activePopups.delete(map);
    }
  };
  // Auto-clean on map destruction in case callers forget to dispose.
  map.once("remove", dispose);
  return dispose;
}

function buildPopupHtml(opts: {
  lng: number;
  lat: number;
  report?: Record<string, unknown>;
  barangay?: Record<string, unknown>;
}) {
  const parts: string[] = [];
  parts.push(
    `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#8b98a9;">${opts.lat.toFixed(4)}°N, ${opts.lng.toFixed(4)}°E</div>`,
  );
  if (opts.barangay?.name) {
    parts.push(
      `<div style="font-weight:500;margin-top:2px;">${escapeHtml(String(opts.barangay.name))}</div>`,
    );
  }
  if (opts.report) {
    const confidence = Number(opts.report.confidence);
    const confidenceText = Number.isFinite(confidence)
      ? `${Math.round(confidence * 100)}%`
      : "unknown";
    const verification = String(opts.report.verificationStatus ?? "unverified");
    const sourceApp = String(opts.report.sourceApp ?? "unknown");
    const sourceChannel = String(opts.report.sourceChannel ?? "");
    const createdAt = formatTimestamp(opts.report.createdAt);
    const photoUrl = safeHttpUrl(opts.report.photoUrl);
    const messageId = String(opts.report.messageId ?? opts.report.id ?? "");
    const onchainTxHash = String(opts.report.onchainTxHash ?? "");
    const onchainStatus = String(opts.report.onchainMintStatus ?? "not_started");

    parts.push(
      `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #262f3b;">` +
        `<div style="color:#ffb84d;font-size:10px;text-transform:uppercase;font-family:'JetBrains Mono',monospace;">${escapeHtml(String(opts.report.category ?? "report"))}</div>` +
        `<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;font-size:9px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;">` +
        `<span style="border:1px solid #f59e0b;color:#f59e0b;border-radius:999px;padding:1px 5px;">${escapeHtml(verification)}</span>` +
        `<span style="border:1px solid #334155;color:#8b98a9;border-radius:999px;padding:1px 5px;">${escapeHtml(confidenceText)} confidence</span>` +
        `<span style="border:1px solid #334155;color:#8b98a9;border-radius:999px;padding:1px 5px;">mint ${escapeHtml(onchainStatus)}</span>` +
        `</div>` +
        `<div style="margin-top:2px;">${escapeHtml(String(opts.report.description ?? ""))}</div>` +
        (messageId
          ? `<div style="margin-top:5px;color:#8b98a9;font-size:10px;font-family:'JetBrains Mono',monospace;">message: ${escapeHtml(messageId)}</div>`
          : "") +
        `<div style="margin-top:5px;color:#8b98a9;font-size:10px;font-family:'JetBrains Mono',monospace;">source: ${escapeHtml(sourceApp)}${sourceChannel ? ` / ${escapeHtml(sourceChannel)}` : ""}</div>` +
        (createdAt
          ? `<div style="margin-top:2px;color:#8b98a9;font-size:10px;font-family:'JetBrains Mono',monospace;">reported: ${escapeHtml(createdAt)}</div>`
          : "") +
        (onchainTxHash
          ? `<a href="https://basescan.org/tx/${escapeHtml(onchainTxHash)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;color:#67e8f9;text-decoration:underline;">View BASE transaction</a>`
          : "") +
        (photoUrl
          ? `<a href="${escapeHtml(photoUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;color:#67e8f9;text-decoration:underline;">Open photo</a>`
          : "") +
        `</div>`,
    );
  }
  return `<div style="color:#e8eef5;background:#11161d;padding:8px;">${parts.join("")}</div>`;
}

function formatTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
