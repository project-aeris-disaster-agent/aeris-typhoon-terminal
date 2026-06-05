import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import { createRoot, type Root } from "react-dom/client";
import { HazardPopupContent } from "@/components/HazardPopupContent";
import type { HazardPopupContentProps, HazardPopupReport } from "@/components/HazardPopupContent";
import { mintExplorerTxUrl } from "@/lib/onchain/explorer-links";
import { REPORTS_MAP_LAYER_IDS } from "@/services/reports-client";

type PopupEntry = {
  popup: Popup;
  root: Root;
  onClose: () => void;
};

const activePopups = new WeakMap<MLMap, PopupEntry>();

export function registerHazardPopup(map: MLMap): () => void {
  const onClick = (e: maplibregl.MapMouseEvent) => {
    const reportLayers = REPORTS_MAP_LAYER_IDS.filter((l) => map.getLayer(l));
    const features = map.queryRenderedFeatures(e.point, {
      layers: [...reportLayers, "lyr-barangay"].filter((l) => map.getLayer(l)),
    });

    const reportFeat = features.find((f) =>
      (REPORTS_MAP_LAYER_IDS as readonly string[]).includes(f.layer.id),
    );
    const barangayFeat = features.find((f) => f.layer.id === "lyr-barangay");

    if (!reportFeat && !barangayFeat) return;

    clearPopup(map);

    const props: HazardPopupContentProps = {
      lat: e.lngLat.lat,
      lng: e.lngLat.lng,
      barangayName: barangayFeat?.properties?.name
        ? String(barangayFeat.properties.name)
        : null,
      report: reportFeat?.properties
        ? buildReportPayload(reportFeat.properties as Record<string, unknown>)
        : null,
    };

    const container = document.createElement("div");
    const root = createRoot(container);
    root.render(<HazardPopupContent {...props} />);

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "260px",
      className: "aeris-popup",
    })
      .setLngLat(e.lngLat)
      .setDOMContent(container)
      .addTo(map);

    const onClose = () => {
      popup.off("close", onClose);
      root.unmount();
      if (activePopups.get(map)?.popup === popup) {
        activePopups.delete(map);
      }
    };
    popup.on("close", onClose);
    activePopups.set(map, { popup, root, onClose });
  };

  map.on("click", onClick);
  const dispose = () => {
    map.off("click", onClick);
    clearPopup(map);
  };
  map.once("remove", dispose);
  return dispose;
}

function clearPopup(map: MLMap) {
  const prev = activePopups.get(map);
  if (!prev) return;
  prev.popup.off("close", prev.onClose);
  prev.root.unmount();
  prev.popup.remove();
  activePopups.delete(map);
}

function buildReportPayload(
  report: Record<string, unknown>,
): HazardPopupReport | null {
  const confidence = Number(report.confidence);
  const confidenceLabel = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : "unknown";
  const verificationStatus = String(report.verificationStatus ?? "unverified");
  const sourceApp = String(report.sourceApp ?? "unknown");
  const sourceChannel = String(report.sourceChannel ?? "");
  const sourceLine = sourceChannel ? `${sourceApp} / ${sourceChannel}` : sourceApp;
  const createdAt = formatTimestamp(report.createdAt);
  const photoHref = safeHttpUrl(report.photoUrl);
  const messageId = String(report.messageId ?? report.id ?? "");
  const onchainTxHash = String(report.onchainTxHash ?? "");
  const onchainNetwork = String(report.onchainNetwork ?? "");
  const onchainTxHref = mintExplorerTxUrl(onchainNetwork, onchainTxHash);

  return {
    category: String(report.category ?? "report"),
    description: String(report.description ?? ""),
    verificationStatus,
    confidenceLabel,
    onchainStatus: String(report.onchainMintStatus ?? "not_started"),
    onchainTxHash: onchainTxHash || null,
    onchainTxHref,
    messageId: messageId || null,
    sourceLine,
    reportedAt: createdAt,
    photoHref,
  };
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
