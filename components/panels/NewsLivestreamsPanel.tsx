"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { useYouTubeFeeds } from "@/components/YouTubeFeedsProvider";
import {
  NEWS_CHANNEL_HANDLES,
  YOUTUBE_NEWS_HANDLES,
} from "@/lib/youtube-feed/constants";
import { getEmbedUrl, type YtVideo } from "@/services/youtube-feeds";

const NEWS_CHANNELS = [
  { handle: YOUTUBE_NEWS_HANDLES[0], label: "GMA News", short: "GMA" },
  { handle: YOUTUBE_NEWS_HANDLES[1], label: "ABS-CBN News", short: "ABS-CBN" },
  { handle: YOUTUBE_NEWS_HANDLES[2], label: "One News PH", short: "One News" },
];

type NewsChannelHandle = (typeof NEWS_CHANNELS)[number]["handle"];

const isPlayableVideo = (video: YtVideo) => video.embeddable !== false;
/** `liveBroadcastContent: "live"` is set by the API (Data API or channel /live page scrape) */
const isConfirmedLive = (video: YtVideo) =>
  video.liveBroadcastContent === "live";

export function NewsLivestreamsPanel() {
  const { state, videosForNews: videos, errorsForNews } = useYouTubeFeeds();
  const loading = state.loading;
  const error =
    errorsForNews.length > 0 ? errorsForNews.join("; ") : null;
  const lastUpdated = state.lastUpdated;

  // Active channel — drives both the iframe and the video list
  const [activeChannel, setActiveChannel] = useState<NewsChannelHandle>(
    NEWS_CHANNELS[0].handle,
  );
  // Active video within that channel (null = show latest / channel live default)
  const [activeVideo, setActiveVideo] = useState<YtVideo | null>(null);
  
  // Track newly detected live channels for highlight animation
  const [newlyLiveChannels, setNewlyLiveChannels] = useState<Set<string>>(
    new Set()
  );
  /** Ref-only: must NOT be a useCallback([videos]) or it recreates `load` every fetch and retriggers useEffect → API spam. */
  const lastLiveChannelHandlesRef = useRef<Set<string>>(new Set());
  /** True after the first successful load completes — used to skip auto-channel-select on subsequent refreshes when the user has manually chosen. */
  const hasLoadedOnceRef = useRef(false);
  /** True when the user has manually picked a channel or video — prevents periodic refreshes from overriding their choice. */
  const userHasPickedRef = useRef(false);

  useEffect(() => {
    if (loading || videos.length === 0) return;

    const prevLiveSnapshot = new Set(lastLiveChannelHandlesRef.current);
    const list = videos.filter(isPlayableVideo);
    const channelWithLive = NEWS_CHANNELS.find((c) =>
      list.some((v) => v.channelHandle === c.handle && isConfirmedLive(v)),
    );

    if (!hasLoadedOnceRef.current || !userHasPickedRef.current) {
      setActiveVideo(null);
      if (channelWithLive) {
        setActiveChannel(channelWithLive.handle);
      } else if (list.length > 0) {
        const h = list[0].channelHandle;
        if (NEWS_CHANNEL_HANDLES.has(h)) {
          setActiveChannel(h as NewsChannelHandle);
        }
      }
    }
    hasLoadedOnceRef.current = true;

    const currentLiveChannels = new Set(
      NEWS_CHANNELS.filter((c) =>
        list.some((v) => v.channelHandle === c.handle && isConfirmedLive(v)),
      ).map((c) => c.handle),
    );
    lastLiveChannelHandlesRef.current = currentLiveChannels;

    const newly = new Set<string>();
    currentLiveChannels.forEach((ch) => {
      if (!prevLiveSnapshot.has(ch)) newly.add(ch);
    });

    if (newly.size > 0) {
      setNewlyLiveChannels(newly);
      const timer = window.setTimeout(() => {
        setNewlyLiveChannels(new Set());
      }, 5000);
      return () => window.clearTimeout(timer);
    }
  }, [videos, loading]);

  // When channel changes (including user-driven), reset to best video for that channel
  useEffect(() => {
    setActiveVideo(null);
  }, [activeChannel]);

  const handleChannelSelect = useCallback((handle: NewsChannelHandle) => {
    userHasPickedRef.current = true;
    setActiveChannel(handle);
  }, []);

  const channelVideos = useMemo(() => {
    const rows = videos.filter(
      (v) => v.channelHandle === activeChannel && isPlayableVideo(v),
    );
    return [...rows].sort((a, b) => {
      const aLive = isConfirmedLive(a);
      const bLive = isConfirmedLive(b);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    });
  }, [videos, activeChannel]);
  
  const bestDefault =
    channelVideos.find((v) => isConfirmedLive(v)) ?? channelVideos[0] ?? null;
  const displayed = activeVideo ?? bestDefault;

  const channelInfo =
    NEWS_CHANNELS.find((c) => c.handle === activeChannel) ?? NEWS_CHANNELS[0];

  const liveChannels = useMemo(
    () =>
      NEWS_CHANNELS.filter((c) =>
        videos.some(
          (v) =>
            v.channelHandle === c.handle &&
            isPlayableVideo(v) &&
            isConfirmedLive(v),
        )
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
      userHasPickedRef.current = true;
      setActiveVideo(channelVideos[currentVideoIndex + 1]);
    }
  }, [currentVideoIndex, hasNextVideo, channelVideos]);
  
  const goToPrevVideo = useCallback(() => {
    if (hasPrevVideo) {
      userHasPickedRef.current = true;
      setActiveVideo(channelVideos[currentVideoIndex - 1]);
    }
  }, [currentVideoIndex, hasPrevVideo, channelVideos]);
  
  const goToMostRecent = useCallback(() => {
    // "Latest" explicitly resets to auto-select — re-enable auto-follow
    userHasPickedRef.current = false;
    setActiveVideo(null);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 space-y-2">
      <CardHeader
        title="News Livestreams"
        helpId="feeds.livestreams"
        subtitle={channelInfo.label}
        trailing={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {NEWS_CHANNELS.map((ch) => {
                const hasLive = videos.some(
                  (v) =>
                    v.channelHandle === ch.handle &&
                    isPlayableVideo(v) &&
                    isConfirmedLive(v),
                );
                const isActive = activeChannel === ch.handle;
                const isNewlyLive = newlyLiveChannels.has(ch.handle);
                return (
                  <button
                    key={ch.handle}
                    type="button"
                    onClick={() => handleChannelSelect(ch.handle)}
                    className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-chrome font-mono uppercase tracking-wider border transition-colors ${
                      isActive
                        ? "bg-aeris-accent/10 border-aeris-accent/40 text-aeris-accent"
                        : isNewlyLive
                          ? "border-aeris-danger/60 bg-aeris-danger/5 text-aeris-text animate-pulse"
                          : "border-aeris-border text-aeris-muted hover:text-aeris-text hover:border-aeris-border/80"
                    }`}
                  >
                    {hasLive && (
                      <span className="w-1 h-1 rounded-full bg-aeris-danger animate-pulse shrink-0" />
                    )}
                    {ch.short}
                  </button>
                );
              })}
            </div>
            {liveChannels.length > 0 ? (
              <Pill tone="danger">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-aeris-danger animate-pulse mr-1" />
                {liveChannels.length} LIVE
              </Pill>
            ) : (
              <Pill tone="default">RECENT</Pill>
            )}
          </div>
        }
      />

      {loading && (
        <div className="space-y-2">
          <div className="w-full flex justify-center shrink-0">
            <div className="aspect-video w-full max-w-xl bg-aeris-elev animate-pulse rounded" />
          </div>
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-aeris-elev animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && videos.length === 0 && (
        <div className="text-body-sm text-aeris-danger px-1 py-2">{error}</div>
      )}

      {!loading && (
        <>
          {/* Main player — centered at all panel widths */}
          <div className="w-full flex justify-center items-center shrink-0">
            {displayed ? (
              <div className="aspect-video w-full max-w-xl bg-black rounded overflow-hidden border border-aeris-border">
                <iframe
                  key={displayed.id}
                  src={getEmbedUrl(
                    displayed.id,
                    true,
                    true,
                    lastUpdated?.getTime(),
                  )}
                  title={displayed.title}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
            ) : (
              <div className="aspect-video w-full max-w-xl bg-aeris-elev rounded flex items-center justify-center text-body-sm text-aeris-muted border border-aeris-border">
                No stream available
              </div>
            )}
          </div>

          {/* Now playing info — aligned to player width */}
          {displayed && (
            <div className="w-full flex justify-center shrink-0">
              <div className="w-full max-w-xl flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="text-body-sm text-aeris-text font-medium leading-snug truncate">
                    {displayed.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-chrome font-mono text-aeris-muted">
                      {channelInfo.label}
                    </span>
                    {isConfirmedLive(displayed) && (
                      <span className="text-chrome font-mono text-aeris-danger">
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
                    className={`px-1.5 py-0.5 rounded text-chrome font-mono border transition-colors ${
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
                    className="px-1.5 py-0.5 rounded text-chrome font-mono border border-aeris-border hover:border-aeris-border/60 hover:bg-aeris-elev/50 text-aeris-muted hover:text-aeris-text transition-colors"
                  >
                    ◆ Latest
                  </button>
                  <button
                    type="button"
                    onClick={goToNextVideo}
                    disabled={!hasNextVideo}
                    title="Next video"
                    className={`px-1.5 py-0.5 rounded text-chrome font-mono border transition-colors ${
                      hasNextVideo
                        ? "border-aeris-border hover:border-aeris-border/60 hover:bg-aeris-elev/50 text-aeris-muted hover:text-aeris-text"
                        : "border-aeris-border/30 text-aeris-muted/40 cursor-not-allowed"
                    }`}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Video list for current channel */}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            <div className="text-chrome font-mono text-aeris-muted uppercase tracking-wider px-0.5 mb-1">
              {channelInfo.label} · Recent
            </div>
            {channelVideos.length === 0 && !loading && (
              <div className="text-body-sm text-aeris-muted py-2 text-center">
                No videos found
              </div>
            )}
            {channelVideos.map((v) => {
              const isSelected = (activeVideo ?? bestDefault)?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { userHasPickedRef.current = true; setActiveVideo(v); }}
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
                    <div className="text-body-sm text-aeris-text leading-tight line-clamp-2">
                      {v.title}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-chrome font-mono text-aeris-muted">
                        {new Date(v.publishedAt).toLocaleDateString()}
                      </span>
                      {isConfirmedLive(v) && (
                        <span className="text-chrome font-mono text-aeris-danger">
                          ● LIVE
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="text-chrome text-aeris-muted font-mono shrink-0">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
            {" "}· YouTube News PH
          </div>
        </>
      )}
    </div>
  );
}
