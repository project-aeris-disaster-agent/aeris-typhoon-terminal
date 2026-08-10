/** @jest-environment node */

import { isPublicPath, isStaticAssetPath } from "@/lib/middleware-paths";

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/refresh",
    "/auth/callback",
    "/api/auth/role",
    "/api/health",
    "/api/cron/daily",
    "/api/internal/triage",
  ])("exempts %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/api/reports",
    "/api/agent/reply",
    "/api/user/profile",
    "/api/community-chat/messages",
    // Removed from PUBLIC_PATHS: both callers are on the authed dashboard.
    "/api/geocode/search",
    "/api/geocode/reverse",
  ])("gates %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  // Prefix matching must respect segment boundaries, or a route merely
  // *starting* with an exempt name inherits the exemption.
  it.each(["/api/authenticate", "/api/cronjobs", "/api/internal-tools", "/logins"])(
    "does not exempt %s on a prefix collision",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe("isStaticAssetPath", () => {
  it.each([
    "/sw.js",
    "/manifest.json",
    "/icon-192.png",
    "/icon.svg",
    "/favicon.ico",
    "/models/aeris-companion.vrm",
    "/flood-hazard/cebu-5yr.json",
    "/dem/heightmap/PHL_msk_alt.gri",
    "/_next/data/build/index.json",
  ])("exempts %s", (path) => {
    expect(isStaticAssetPath(path)).toBe(true);
  });

  // The regression this guards: an extension-suffix exemption in front of a
  // filesystem router means any future API route whose last segment ends in a
  // static extension becomes unauthenticated with nothing in the route file to
  // hint at it. /api/ is never eligible for the suffix test.
  it.each([
    "/api/reports.json",
    "/api/reports/export.json",
    "/api/reports/abc.png",
    "/api/rainviewer/tiles/1/2/3.png",
    "/api/internal/dump.js",
    "/api/user/profile.css",
  ])("never exempts %s", (path) => {
    expect(isStaticAssetPath(path)).toBe(false);
  });

  it.each(["/", "/login", "/api/reports", "/chat"])(
    "does not exempt the page or API path %s",
    (path) => {
      expect(isStaticAssetPath(path)).toBe(false);
    },
  );
});
