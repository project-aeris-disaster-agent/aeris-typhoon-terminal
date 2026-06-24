import { isCoarsePointerDevice } from "@/lib/device-tier";

/** Public chat product — mobile-friendly alternative to the dashboard. */
export const BAGYO_APP_URL = "https://bagyo.app";

const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return MOBILE_UA_RE.test(userAgent);
}

/**
 * Client-side mobile detection for access gating. Combines coarse pointer,
 * narrow viewport, and user-agent signals so phones and typical tablets qualify.
 */
export function isMobileDeviceClient(): boolean {
  if (typeof window === "undefined") return false;
  if (isCoarsePointerDevice()) return true;
  if (window.matchMedia("(max-width: 767px)").matches) return true;
  return isMobileUserAgent(navigator.userAgent);
}

export function shouldBlockMobileDashboardAccess(args: {
  mobile: boolean;
  authDisabled: boolean;
  role: string;
  userId: string | null;
}): boolean {
  if (!args.mobile || args.authDisabled) return false;
  if (!args.userId) return false;
  return args.role !== "admin";
}
