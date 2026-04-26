"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CardHeader, Pill } from "../ui/Card";
import {
  fetchYouTubeFeeds,
  getEmbedUrl,
  type YtVideo,
} from "@/services/youtube-feeds";

const NEWS_CHANNELS = [
  { handle: "gmanews2026", label: "GMA News", short: "GMA" },
  { handle: "abscbnnews", label: "ABS-CBN News", short: "ABS-CBN" },
  { handle: "OneNewsPH", label: "One News PH", short: "One News" },
];

const REFRESH_INTERVAL_MS = 90 * 1000;

export function NewsLivestreamsPanel() {
  const [videos, setVideos] = useState<YtVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Active channel — drives both the iframe and the video list
  const [activeChannel, setActiveChannel] = useState(NEWS_CHANNELS[0].handle);
  // Active video within that channel (null = show latest / channel live default)
  const [activeVideo, setActiveVideo] = useState<YtVideo | null>(null);
  
  // Track newly detected live channels for highlight animation
  const [newlyLiveChannels, setNewlyLiveChannels] = useState<Set<string>>(
    new Set()
  );
  /** Ref-only: must NOT be a useCallback([videos]) or it recreates `load` every fetch and retriggers useEffect → API spam. */
  const lastLiveChannelHandlesRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const prevLiveSnapshot = new Set(lastLiveChannelHandlesRef.current);

      const result = await fetchYouTubeFeeds(
        NEWS_CHANNELS.map((c) => `@${c.handle}`),
        { bypassClientCache: true },
      );
      setVideos(result.videos);
      setError(result.errors.length > 0 ? result.errors.join("; ") : null);
      setLastUpdated(new Date());

      // Always follow live if any channel has one; otherwise newest upload globally (API sort).
      setActiveVideo(null);
      const list = result.videos;
      const channelWithLive = NEWS_CHANNELS.find((c) =>
        list.some((v) => v.channelHandle === c.handle && v.isLikeLive),
      );
      if (channelWithLive) {
        setActiveChannel(channelWithLive.handle);
      } else if (list.length > 0) {
        setActiveChannel(list[0].channelHandle);
      }

      const currentLiveChannels = new Set(
        NEWS_CHANNELS.filter((c) =>
          result.videos.some((v) => v.channelHandle === c.handle && v.isLikeLive)
        ).map((c) => c.handle)
      );
      lastLiveChannelHandlesRef.current = currentLiveChannels;

      const newly = new Set<string>();
      currentLiveChannels.forEach((ch) => {
        if (!prevLiveSnapshot.has(ch)) newly.add(ch);
      });

      if (newly.size > 0) {
        setNewlyLiveChannels(newly);
        setTimeout(() => {
          setNewlyLiveChannels(new Set());
        }, 5000);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // When channel changes, reset to the best video for that channel
  useEffect(() => {
    setActiveVideo(null);
  }, [activeChannel]);

  const channelVideos = useMemo(() => {
    const rows = videos.filter((v) => v.channelHandle === activeChannel);
    return [...rows].sort((a, b) => {
      if (a.isLikeLive !== b.isLikeLive) return a.isLikeLive ? -1 : 1;
      return (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    });
  }, [videos, activeChannel]);
  
  const bestDefault =
    channelVideos.find((v) => v.isLikeLive) ?? channelVideos[0] ?? null;
  const displayed = activeVideo ?? bestDefault;

  const channelInfo =
    NEWS_CHANNELS.find((c) => c.handle === activeChannel) ?? NEWS_CHANNELS[0];

  const liveChannels = useMemo(
    () =>
      NEWS_CHANNELS.filter((c) =>
        videos.some((v) => v.channelHandle === c.handle && v.isLikeLive)
      ),
    [videos]
  );

  // Navigation through videos
  const currentVideoIndex = channelVideos.findIndex(
    (v) => v.id === displayed?.id
  );
  
  const hasNextVideo = currentVideoIndex < channelVideos.length - 1;
  const hasPrevVideo = currentVideoIndex > 0;
  
  const goToNextVideo = useCallback(() => {
    if (hasNextVideo) {
      const nextIdx = currentVideoIndex + 1;
      setActiveVideo(channelVideos[nextIdx]);
    }
  }, [currentVideoIndex, hasNextVideo, channelVideos]);
  
  const goToPrevVideo = useCallback(() => {
    if (hasPrevVideo) {
      const prevIdx = currentVideoIndex - 1;
      setActiveVideo(channelVideos[prevIdx]);
    }
  }, [currentVideoIndex, hasPrevVideo, channelVideos]);
  
  const goToMostRecent = useCallback(() => {
    setActiveVideo(null);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 space-y-2">
      <CardHeader
        title="News Livestreams"
        subtitle={channelInfo.label}
        trailing={
          liveChannels.length > 0 ? (
            <Pill tone="danger">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-aeris-danger animate-pulse mr-1" />
              {liveChannels.length} LIVE
            </Pill>
          ) : (
            <Pill tone="default">RECENT</Pill>
          )
        }
      />

      {/* Channel switcher */}
      <div className="flex gap-1 shrink-0">
        {NEWS_CHANNELS.map((ch) => {
          const hasLive = videos.some(
            (v) => v.channelHandle === ch.handle && v.isLikeLive,
          );
          const isActive = activeChannel === ch.handle;
          const isNewlyLive = newlyLiveChannels.has(ch.handle);
          return (
            <button
              key={ch.handle}
              type="button"
              onClick={() => setActiveChannel(ch.handle)}
              className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[10px] font-mono border transition-all ${
                isActive
                  ? "bg-aeris-accent/10 border-aeris-accent/40 text-aeris-accent"
                  : isNewlyLive
                    ? "border-aeris-danger/60 bg-aeris-danger/5 text-aeris-text animate-pulse"
                    : "border-aeris-border text-aeris-muted hover:text-aeris-text hover:border-aeris-border/80"
              }`}
            >
              {hasLive && (
                <span className="w-1.5 h-1.5 rounded-full bg-aeris-danger animate-pulse shrink-0" />
              )}
              {ch.short}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="aspect-video bg-aeris-elev animate-pulse rounded" />
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-aeris-elev animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && videos.length === 0 && (
        <div className="text-[11px] text-aeris-danger px-1 py-2">{error}</div>
      )}

      {!loading && (
        <>
          {/* Main player */}
          {displayed ? (
            <div className="aspect-video bg-black rounded overflow-hidden border border-aeris-border shrink-0">
              <iframe
                key={displayed.id}
                src={getEmbedUrl(displayed.id, true, true)}
                title={displayed.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          ) : (
            <div className="aspect-video bg-aeris-elev rounded flex items-center justify-center text-[11px] text-aeris-muted border border-aeris-border shrink-0">
              No stream available
            </div>
          )}

          {/* Now playing info */}
          {displayed && (
            <div className="flex items-start justify-between gap-2 min-w-0 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-aeris-text font-medium leading-snug truncate">
                  {displayed.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] font-mono text-aeris-muted">
                    {channelInfo.label}
                  </span>
                  {displayed.isLikeLive && (
                    <span className="text-[9px] font-mono text-aeris-danger">
                      ● LIVE
                    </span>
                  )}
                </div>
              </div>
              
              {/* Navigation buttons */}
              <div className="flex gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={goToPrevVideo}
                  disabled={!hasPrevVideo}
                  title="Previous video"
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                    hasPrevVideo
                      ? "border-aeris-border hover:border-aeris-border/60 hover:bg-aeris-elev/50 text-aeris-muted hover:text-aeris-text"
                      : "border-aeris-border/30 text-aeris-muted/40 cursor-not-allowed"
                  }`}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  onClick={goToMostRecent}
                  title="Most recent or live"
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono border border-aeris-border hover:border-aeris-border/60 hover:bg-aeris-elev/50 text-aeris-muted hover:text-aeris-text transition-colors"
                >
                  ◆ Latest
                </button>
                <button
                  type="button"
                  onClick={goToNextVideo}
                  disabled={!hasNextVideo}
                  title="Next video"
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                    hasNextVideo
                      ? "border-aeris-border hover:border-aeris-border/60 hover:bg-aeris-elev/50 text-aeris-muted hover:text-aeris-text"
                      : "border-aeris-border/30 text-aeris-muted/40 cursor-not-allowed"
                  }`}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Video list for current channel */}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            <div className="text-[9px] font-mono text-aeris-muted uppercase tracking-wider px-0.5 mb-1">
              {channelInfo.label} · Recent
            </div>
            {channelVideos.length === 0 && !loading && (
              <div className="text-[11px] text-aeris-muted py-2 text-center">
                No videos found
              </div>
            )}
            {channelVideos.map((v) => {
              const isSelected = (activeVideo ?? bestDefault)?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActiveVideo(v)}
                  className={`w-full flex items-start gap-2 p-1.5 rounded text-left transition-colors ${
                    isSelected
                      ? "bg-aeris-accent/10 border border-aeris-accent/30"
                      : "hover:bg-aeris-elev border border-transparent"
                  }`}
                >
                  <img
                    src={v.thumbnailUrl}
                    alt={v.title}
                    className="w-16 h-9 rounded object-cover shrink-0 bg-aeris-elev"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-aeris-text leading-tight line-clamp-2">
                      {v.title}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-mono text-aeris-muted">
                        {new Date(v.publishedAt).toLocaleDateString()}
                      </span>
                      {v.isLikeLive && (
                        <span className="text-[9px] font-mono text-aeris-danger">
                          ● LIVE
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="text-[9px] text-aeris-muted font-mono shrink-0">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
            {" "}· YouTube News PH
          </div>
        </>
      )}
    </div>
  );
}
