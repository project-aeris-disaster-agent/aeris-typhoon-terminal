import {
  isMobileUserAgent,
  shouldBlockMobileDashboardAccess,
} from "@/lib/mobile-access";

describe("mobile-access", () => {
  describe("isMobileUserAgent", () => {
    it("detects common phone user agents", () => {
      expect(
        isMobileUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        ),
      ).toBe(true);
      expect(
        isMobileUserAgent(
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        ),
      ).toBe(true);
    });

    it("does not classify desktop Chrome as mobile", () => {
      expect(
        isMobileUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        ),
      ).toBe(false);
    });
  });

  describe("shouldBlockMobileDashboardAccess", () => {
    it("blocks signed-in non-admin mobile users", () => {
      expect(
        shouldBlockMobileDashboardAccess({
          mobile: true,
          authDisabled: false,
          role: "guest_viewer",
          userId: "did:privy:abc",
        }),
      ).toBe(true);
    });

    it("allows admin wallet users on mobile", () => {
      expect(
        shouldBlockMobileDashboardAccess({
          mobile: true,
          authDisabled: false,
          role: "admin",
          userId: "did:privy:admin",
        }),
      ).toBe(false);
    });

    it("allows everyone when auth is disabled", () => {
      expect(
        shouldBlockMobileDashboardAccess({
          mobile: true,
          authDisabled: true,
          role: "guest_viewer",
          userId: "did:privy:abc",
        }),
      ).toBe(false);
    });
  });
});
