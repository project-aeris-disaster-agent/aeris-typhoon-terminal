import { isPhoneSizedCoarseDevice } from "@/lib/device-tier";

/** Public chat product — mobile-friendly alternative to the dashboard. */
export const BAGYO_APP_URL = "https://bagyo.app";

// Phones only. Tablets (iPad / Android tablets) get the full dashboard, so
// this deliberately excludes iPad and bare "Android" (Android tablet UAs
// omit the "Mobile" token that phones carry).
const PHONE_UA_RE =
  /iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini|webOS/i;

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  if (/iPad/i.test(userAgent)) return false;
  if (PHONE_UA_RE.test(userAgent)) return true;
  return /Android/i.test(userAgent) && /\bMobile\b/i.test(userAgent);
}

/**
 * Client-side phone detection for access gating. Tablets (iPad and Android
 * tablets) are allowed on the dashboard; only phone-sized touch devices are
 * gated to bagyo.app. iPadOS reports a desktop (Macintosh) user agent, so a
 * UA-independent fallback classifies coarse-pointer devices by screen size:
 * anything with a smallest side under 600 CSS px is treated as a phone.
 */
export function isMobileDeviceClient(): boolean {
  if (typeof window === "undefined") return false;
  if (isMobileUserAgent(navigator.userAgent)) return true;
  return isPhoneSizedCoarseDevice();
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
