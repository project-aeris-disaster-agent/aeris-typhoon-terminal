import type { CctvLocation } from "@/services/cctv-locations";

export type YtVideo = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelName: string;
  channelHandle: string;
  isLikeLive: boolean;
  embeddable?: boolean;
  liveBroadcastContent?: "live" | "upcoming" | "none";
  location?: CctvLocation | null;
};

export type YtFeedResult = {
  videos: YtVideo[];
  errors: string[];
};

export type ChannelCacheRow = {
  channel_handle: string;
  videos: YtVideo[];
  errors: string[];
  fetched_at: string;
  expires_at: string;
  refreshing_until: string | null;
};
