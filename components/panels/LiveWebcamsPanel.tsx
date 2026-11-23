"use client";

import { useState, useEffect, useCallback } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import { useYouTubeFeeds } from "@/components/YouTubeFeedsProvider";
import {
  extractLocation,
  getEmbedUrl,
  type YtVideo,
} from "@/services/youtube-feeds";
import { shouldIgnoreHotkey } from "@/lib/hotkeys";
import { MapPin, Pencil, Plus, RefreshCw, X } from "lucide-react";

/** Round white button over a video tile (the game's map buttons). Fixed light
 *  colours on purpose: it sits on video, not on the themed surface. */
const CAM_BTN =
  "flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[#39536f] shadow-pill transition-colors hover:text-[#1f6fd1]";

const SLOT_STORAGE_KEY = "aeris.liveWebcams.slotIds.v1";

const isPlayableVideo = (video: YtVideo) => video.embeddable !== false;

const GRID_AUTO_FILL_SLOTS = 6;

/** Prefer live streams; pad with other playable feeds when fewer lives than grid slots. */
function videosForAutoFill(
  videos: YtVideo[],
  minSlots = GRID_AUTO_FILL_SLOTS,
): YtVideo[] {
  const playable = videos.filter(isPlayableVideo);
  const live = playable.filter((v) => v.isLikeLive);
  if (live.length === 0) return playable;
  if (live.length >= minSlots) return live;
  const used = new Set(live.map((v) => v.id));
  const rest = playable.filter((v) => !used.has(v.id));
  return [...live, ...rest.slice(0, minSlots - live.length)];
}

/** Persisted slot assignments by id; resolved against the live video list on load. */
type StoredSlots = (string | null)[];

function loadStoredSlots(): StoredSlots | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SLOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => (typeof v === "string" ? v : null));
  } catch {
    return null;
  }
}

function persistSlots(slots: (YtVideo | null)[]): void {
  if (typeof window === "undefined") return;
  try {
    const ids: StoredSlots = slots.map((s) => s?.id ?? null);
    window.localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage may be disabled in private mode */
  }
}

const GRID_LAYOUTS = [1, 2, 4, 6] as const;
type GridSize = (typeof GRID_LAYOUTS)[number];

const GRID_COLS: Record<GridSize, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  4: "grid-cols-2",
  6: "grid-cols-3",
};

/** Which slot is currently being assigned in the picker */
type PickMode = { slotIndex: number } | null;

function SlotFrame({
  video,
  slotIndex,
  isPickTarget,
  onPick,
  onNextCamera,
  onShowOnMap,
}: {
  video: YtVideo | null;
  slotIndex: number;
  isPickTarget: boolean;
  onPick: (slotIndex: number) => void;
  onNextCamera: (slotIndex: number) => void;
  onShowOnMap: (video: YtVideo) => void;
}) {
  // Prefer the structured location resolved server-side (which drops the map
  // ping); fall back to the legacy title-keyword extractor for the overlay
  // label so old-style entries without a geocode still show *something*.
  const locLabel = video?.location?.label ?? (video ? extractLocation(video.title) : null);
  const hasGeocode = Boolean(video?.location);

  return (
    <div
      className={`relative h-full min-h-0 bg-black rounded-xl overflow-hidden transition-shadow ${
        isPickTarget ? "ring-2 ring-aeris-accent" : "shadow-pill"
      }`}
      // 16:9 is only a fallback minimum — inside the auto-rows-fr grid the
      // h-full wins so tiles fill their row and no gaps open between rows.
      style={{ aspectRatio: "16/9" }}
    >
      {video ? (
        <>
          <div className="absolute inset-0 overflow-hidden">
            <iframe
              key={video.id}
              src={getEmbedUrl(video.id, true, true, { minimalChrome: true })}
              title={video.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="w-full h-full pointer-events-none"
            />
            {/* Shield hover/clicks so YouTube in-player overlays never appear */}
            <div className="absolute inset-0 z-[1]" aria-hidden="true" />
          </div>
          {/* Overlay label */}
          {/* Overlay label: the game's floating map label (white pill). */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 pointer-events-none">
            <span className="min-w-0 truncate rounded-full bg-white/90 px-2 py-0.5 text-[0.6875rem] font-extrabold text-[#0f2a47] shadow-pill">
              {hasGeocode && <MapPin size={10} className="mr-0.5 inline text-[#1f6fd1]" aria-hidden />}
              {locLabel ?? video.title.slice(0, 28)}
            </span>
          </div>
          {/* LIVE sits top-left so narrow tiles never clip it. */}
          {video.isLikeLive && (
            <span className="pointer-events-none absolute left-1.5 top-1.5 z-[2] flex items-center gap-1 rounded-full bg-[#c8363c] px-1.5 py-0.5 text-[0.5625rem] font-black uppercase tracking-[0.1em] text-white shadow-pill">
              <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
              Live
            </span>
          )}
          {/* Control buttons: round white map buttons. */}
          <div className="absolute top-1.5 right-1.5 z-[2] flex gap-1 pointer-events-auto">
            {hasGeocode && (
              <button
                type="button"
                onClick={() => onShowOnMap(video)}
                className={CAM_BTN}
                title={`Show on map · ${video.location?.label ?? ""}`}
                aria-label="Show on map"
              >
                <MapPin size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => onNextCamera(slotIndex)}
              className={CAM_BTN}
              title="Next camera"
              aria-label="Next camera"
            >
              <RefreshCw size={12} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onPick(slotIndex)}
              className={CAM_BTN}
              title="Pick camera"
              aria-label="Pick camera"
            >
              <Pencil size={12} aria-hidden />
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => onPick(slotIndex)}
          className="w-full h-full flex flex-col items-center justify-center bg-aeris-elev text-aeris-ink2 hover:text-aeris-accent transition-colors gap-1"
        >
          <Plus size={18} aria-hidden />
          <span className="text-[0.6875rem] font-black uppercase tracking-[0.12em]">Add stream</span>
        </button>
      )}
    </div>
  );
}

export function LiveWebcamsPanel({ map }: { map: MLMap | null }) {
  const { state, videosForJazbaz: videos } = useYouTubeFeeds();
  const loading = state.loading;
  const error =
    state.errors.length > 0 ? state.errors.join("; ") : null;
  const lastUpdated = state.lastUpdated;

  const [slots, setSlots] = useState<(YtVideo | null)[]>([
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  const [gridSize, setGridSize] = useState<GridSize>(6);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [pickerLiveOnly, setPickerLiveOnly] = useState(true);

  useEffect(() => {
    if (loading) return;

    const fillQueue = videosForAutoFill(videos);
    const stored = loadStoredSlots();
    const fillById = new Map(fillQueue.map((v) => [v.id, v]));

    setSlots((prev) => {
      const len = Math.max(prev.length, 6);
      const next: (YtVideo | null)[] = Array.from({ length: len }, () => null);

      if (stored) {
        for (let i = 0; i < next.length && i < stored.length; i++) {
          const id = stored[i];
          if (id) {
            const found = fillById.get(id);
            if (found) next[i] = found;
          }
        }
      }

      const usedIds = new Set(
        next.filter(Boolean).map((v) => (v as YtVideo).id),
      );
      const queue = fillQueue.filter((v) => !usedIds.has(v.id));
      let qi = 0;
      for (let i = 0; i < next.length; i++) {
        if (!next[i] && qi < queue.length) {
          next[i] = queue[qi++];
        }
      }
      return next;
    });
  }, [videos, loading]);

  const liveCount = videos.filter((v) => v.isLikeLive).length;

  const handlePickSlot = (slotIndex: number) => {
    setPickMode({ slotIndex });
  };

  const handleAssignVideo = (video: YtVideo) => {
    if (!pickMode) return;
    setSlots((prev) => {
      const next = [...prev];
      next[pickMode.slotIndex] = video;
      return next;
    });
    setPickMode(null);
  };

  const handleClearSlot = (slotIndex: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  };

  const handleGridChange = (size: GridSize) => {
    setGridSize(size);
    setSlots((prev) => {
      const next = [...prev];
      while (next.length < size) next.push(null);
      const usedIds = new Set(next.filter(Boolean).map((v) => v!.id));
      // Live-only auto-fill — same rule as `load()` above. The user can pick
      // a non-live video via the ✎ picker if they want a recording.
      const queue = videosForAutoFill(videos).filter((v) => !usedIds.has(v.id));
      let qi = 0;
      for (let i = 0; i < size; i++) {
        if (!next[i] && qi < queue.length) {
          next[i] = queue[qi++];
        }
      }
      return next.slice(0, size);
    });
    setPickMode(null);
  };

  const handleShowOnMap = useCallback(
    (video: YtVideo) => {
      if (!map || !video.location) return;
      map.flyTo({
        center: [video.location.lon, video.location.lat],
        zoom: Math.max(map.getZoom(), 14),
        speed: 1.4,
        curve: 1.6,
        essential: true,
      });
    },
    [map],
  );

  const handleNextCamera = useCallback(
    (slotIndex: number) => {
      if (videos.length === 0) return;
      setSlots((prev) => {
        const next = [...prev];
        const currentVideo = next[slotIndex];
        const currentIndex = currentVideo
          ? videos.findIndex((v) => v.id === currentVideo.id)
          : -1;
        const nextIndex = (currentIndex + 1) % videos.length;
        next[slotIndex] = videos[nextIndex];
        return next;
      });
    },
    [videos],
  );

  useEffect(() => {
    persistSlots(slots);
  }, [slots]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreHotkey(e)) return;
      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= gridSize) {
        e.preventDefault();
        handleNextCamera(num - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gridSize, handleNextCamera]);

  const visibleSlots = slots.slice(0, gridSize);

  return (
    <div className="flex flex-col h-full min-h-0 space-y-2">
      <CardHeader
        title="Live Webcams"
        helpId="feeds.webcams"
        trailing={
          <div className="flex items-center gap-1.5">
            {liveCount > 0 ? (
              <Pill tone="danger">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-aeris-danger animate-pulse mr-1" />
                {liveCount} LIVE
              </Pill>
            ) : (
              <Pill tone="default">RECENT</Pill>
            )}
            <div className="aeris-seg" role="group" aria-label="Webcam grid size">
              {GRID_LAYOUTS.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => handleGridChange(size)}
                  aria-pressed={gridSize === size}
                  className="aeris-seg-btn h-6 w-6 !flex-none text-[0.75rem] tabular-nums"
                  title={`${size} stream${size > 1 ? "s" : ""}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {pickMode !== null && (
        <div className="flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={() => setPickMode(null)}
            className="aeris-btn-soft h-7 px-3 text-[0.75rem]"
          >
            <X size={12} aria-hidden /> Cancel
          </button>
        </div>
      )}

      {loading && (
        <div
          className={`grid ${GRID_COLS[gridSize]} gap-1`}
        >
          {visibleSlots.map((_, i) => (
            <div
              key={i}
              className="bg-aeris-elev animate-pulse rounded-xl"
              style={{ aspectRatio: "16/9" }}
            />
          ))}
        </div>
      )}

      {!loading && error && videos.length === 0 && (
        <div className="text-body-sm text-aeris-danger px-1 py-2">{error}</div>
      )}

      {!loading && (
        <>
          {/* CCTV grid — rows stretch to fill the panel height (tiles keep a
              16:9 minimum via aspect-ratio; YouTube letterboxes the rest) so
              the column has no dead space below the grid. */}
          {!pickMode && (
            <div
              className={`grid ${GRID_COLS[gridSize]} auto-rows-fr gap-1.5 flex-1 min-h-0`}
            >
              {visibleSlots.map((video, i) => (
                <SlotFrame
                  key={i}
                  video={video}
                  slotIndex={i}
                  isPickTarget={false}
                  onPick={handlePickSlot}
                  onNextCamera={handleNextCamera}
                  onShowOnMap={handleShowOnMap}
                />
              ))}
            </div>
          )}

          {/* Picker overlay: select a stream for the chosen slot */}
          {pickMode && (
            <div className="flex-1 min-h-0 flex flex-col space-y-1">
              <div className="flex items-center justify-between px-0.5">
                <div className="aeris-title">
                  Select stream for slot {pickMode.slotIndex + 1}
                </div>
                <label className="flex items-center gap-1.5 text-body-sm font-bold text-aeris-ink2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pickerLiveOnly}
                    onChange={(e) => setPickerLiveOnly(e.target.checked)}
                    className="accent-aeris-accent"
                  />
                  Live only
                </label>
              </div>
              {/* Current slot preview */}
              {slots[pickMode.slotIndex] && (
                <div className="flex items-center justify-between rounded-xl bg-aeris-chip-on px-2.5 py-1.5 text-body-sm">
                  <span className="truncate font-bold text-aeris-ink2">
                    Current: {slots[pickMode.slotIndex]?.title.slice(0, 40)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      handleClearSlot(pickMode.slotIndex);
                      setPickMode(null);
                    }}
                    className="ml-2 shrink-0 font-black text-aeris-danger hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                {videos
                  .filter((v) => (pickerLiveOnly ? v.isLikeLive : true))
                  .sort((a, b) => Number(b.isLikeLive) - Number(a.isLikeLive))
                  .map((v) => {
                  const loc = v.location?.label ?? extractLocation(v.title);
                  const hasGeo = Boolean(v.location);
                  const isInSlot = visibleSlots.some((s) => s?.id === v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleAssignVideo(v)}
                      disabled={isInSlot && slots[pickMode.slotIndex]?.id !== v.id}
                      className={`aeris-row w-full flex items-start gap-2.5 p-1.5 text-left ${
                        isInSlot && slots[pickMode.slotIndex]?.id !== v.id
                          ? "opacity-40 cursor-not-allowed"
                          : ""
                      }`}
                    >
                      <img
                        src={v.thumbnailUrl}
                        alt={v.title}
                        className="w-16 h-9 rounded-lg object-cover shrink-0 bg-aeris-elev"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-body-sm font-bold text-aeris-text leading-tight line-clamp-2">
                          {v.title}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {v.isLikeLive && (
                            <span className="text-[0.625rem] font-black uppercase tracking-[0.1em] text-aeris-danger">
                              ● LIVE
                            </span>
                          )}
                          {loc && (
                            <span
                              className={`text-[0.6875rem] font-bold truncate ${
                                hasGeo ? "text-aeris-accent" : "text-aeris-muted"
                              }`}
                              title={
                                hasGeo
                                  ? `Mapped — confidence: ${v.location?.confidence}`
                                  : "Location parsed from title text"
                              }
                            >
                              📍 {loc}
                            </span>
                          )}
                          {isInSlot && slots[pickMode.slotIndex]?.id === v.id && (
                            <span className="text-[0.6875rem] font-black text-aeris-warn">
                              ← current
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-[0.6875rem] font-bold text-aeris-muted shrink-0 mt-auto">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
            {" "}· @JazBazPhilippines
          </div>
        </>
      )}
    </div>
  );
}
