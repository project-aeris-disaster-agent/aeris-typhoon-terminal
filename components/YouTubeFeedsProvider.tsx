"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  JAZBAZ_CHANNEL_HANDLE,
  NEWS_CHANNEL_HANDLES,
  YOUTUBE_FEED_CHANNELS,
} from "@/lib/youtube-feed/constants";
import {
  fetchYouTubeFeeds,
  type YtFeedResult,
  type YtVideo,
} from "@/services/youtube-feeds";

const REFRESH_MS_ACTIVE = 90 * 1000;
const REFRESH_MS_IDLE = 5 * 60 * 1000;

type YouTubeFeedsState = YtFeedResult & {
  loading: boolean;
  lastUpdated: Date | null;
};

type YouTubeFeedsContextValue = {
  state: YouTubeFeedsState;
  refresh: () => Promise<void>;
  videosForNews: YtVideo[];
  videosForJazbaz: YtVideo[];
  errorsForNews: string[];
};

const YouTubeFeedsContext = createContext<YouTubeFeedsContextValue | null>(
  null,
);

export function YouTubeFeedsProvider({
  children,
  feedsExpanded = true,
}: {
  children: ReactNode;
  /** When false (Intel Feeds collapsed), poll less often for map pings only. */
  feedsExpanded?: boolean;
}) {
  const [state, setState] = useState<YouTubeFeedsState>({
    videos: [],
    errors: [],
    loading: true,
    lastUpdated: null,
  });

  const refresh = useCallback(async () => {
    try {
      const result = await fetchYouTubeFeeds([...YOUTUBE_FEED_CHANNELS]);
      setState({
        videos: result.videos,
        errors: result.errors,
        loading: false,
        lastUpdated: new Date(),
      });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        loading: false,
        errors: [...prev.errors, (e as Error).message],
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const prevFeedsExpandedRef = useRef(feedsExpanded);
  useEffect(() => {
    if (!prevFeedsExpandedRef.current && feedsExpanded) {
      void refresh();
    }
    prevFeedsExpandedRef.current = feedsExpanded;
  }, [feedsExpanded, refresh]);

  useEffect(() => {
    const intervalMs = feedsExpanded ? REFRESH_MS_ACTIVE : REFRESH_MS_IDLE;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    };

    const id = window.setInterval(tick, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [feedsExpanded, refresh]);

  const videosForNews = useMemo(
    () =>
      state.videos.filter((v) => NEWS_CHANNEL_HANDLES.has(v.channelHandle)),
    [state.videos],
  );

  const videosForJazbaz = useMemo(
    () =>
      state.videos.filter((v) => v.channelHandle === JAZBAZ_CHANNEL_HANDLE),
    [state.videos],
  );

  const errorsForNews = useMemo(() => {
    const prefixes = [...NEWS_CHANNEL_HANDLES];
    return state.errors.filter((err) =>
      prefixes.some((h) => err.startsWith(`${h}:`)),
    );
  }, [state.errors]);

  const value = useMemo(
    () => ({
      state,
      refresh,
      videosForNews,
      videosForJazbaz,
      errorsForNews,
    }),
    [state, refresh, videosForNews, videosForJazbaz, errorsForNews],
  );

  return (
    <YouTubeFeedsContext.Provider value={value}>
      {children}
    </YouTubeFeedsContext.Provider>
  );
}

export function useYouTubeFeeds(): YouTubeFeedsContextValue {
  const ctx = useContext(YouTubeFeedsContext);
  if (!ctx) {
    throw new Error("useYouTubeFeeds must be used within YouTubeFeedsProvider");
  }
  return ctx;
}
