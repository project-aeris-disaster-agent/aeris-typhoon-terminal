export type LiveCam = {
  id: string;
  region: string;
  label: string;
  provider: string;
  embedUrl: string;
};

/**
 * Public livestreams relevant to typhoon / disaster response.
 *
 * These are placeholder YouTube search embeds. Operators can replace with
 * specific stream IDs from DOST, NDRRMC, PAGASA, or local LGU broadcasters.
 * Format: https://www.youtube.com/embed/VIDEO_ID or live channel URL.
 */
export const LIVE_CAMS: LiveCam[] = [
  {
    id: "dost-pagasa",
    region: "National",
    label: "PAGASA Weather Bureau",
    provider: "DOST-PAGASA",
    embedUrl:
      "https://www.youtube.com/embed/live_stream?channel=UCVH4HI5eaqE31Ii7uH9gFJA",
  },
  {
    id: "ndrrmc",
    region: "National",
    label: "NDRRMC Press Briefing",
    provider: "NDRRMC",
    embedUrl:
      "https://www.youtube.com/embed/live_stream?channel=UCZ-m0i0Q7qxzKYm9T0d5CjQ",
  },
  {
    id: "ncr-mmda",
    region: "NCR",
    label: "MMDA Traffic Cam",
    provider: "MMDA",
    embedUrl: "https://mmdatraffic.interaksyon.com/",
  },
  {
    id: "abs-cbn",
    region: "National",
    label: "ABS-CBN News Live",
    provider: "ABS-CBN",
    embedUrl:
      "https://www.youtube.com/embed/live_stream?channel=UCng0nPNqrGjbhSTZrJFzt_A",
  },
];
