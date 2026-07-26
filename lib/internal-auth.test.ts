/** @jest-environment node */

import {
  authorizeCronRequest,
  authorizeInternalRequest,
  requestPresentsSecret,
  secretsMatch,
} from "@/lib/internal-auth";

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/daily", { headers });
}

describe("internal-auth", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.CRON_SECRET = "cron-secret";
    process.env.INTERNAL_TRIAGE_SECRET = "triage-secret";
  });

  afterEach(() => {
    process.env = env;
  });

  describe("secretsMatch", () => {
    it("matches identical secrets", () => {
      expect(secretsMatch("abc", "abc")).toBe(true);
    });

    it("rejects different secrets of equal length", () => {
      expect(secretsMatch("abc", "abd")).toBe(false);
    });

    it("rejects different secrets of differing length without throwing", () => {
      expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
    });

    it("rejects empty or missing values", () => {
      expect(secretsMatch("", "abc")).toBe(false);
      expect(secretsMatch("abc", undefined)).toBe(false);
      expect(secretsMatch(null, null)).toBe(false);
    });
  });

  describe("requestPresentsSecret", () => {
    it("accepts a matching Bearer token", () => {
      expect(requestPresentsSecret(req({ authorization: "Bearer s" }), "s")).toBe(true);
    });

    it("ignores a non-Bearer authorization scheme", () => {
      expect(requestPresentsSecret(req({ authorization: "Basic s" }), "s")).toBe(false);
    });

    it("accepts the custom header when one is configured", () => {
      expect(requestPresentsSecret(req({ "x-secret": "s" }), "s", "x-secret")).toBe(true);
    });

    it("ignores the custom header when none is configured", () => {
      expect(requestPresentsSecret(req({ "x-secret": "s" }), "s")).toBe(false);
    });

    it("rejects when the expected secret is unset", () => {
      expect(requestPresentsSecret(req({ authorization: "Bearer s" }), undefined)).toBe(false);
      expect(requestPresentsSecret(req({ authorization: "Bearer  " }), "  ")).toBe(false);
    });
  });

  describe("authorizeCronRequest", () => {
    it("accepts the cron secret as a Bearer token", () => {
      expect(authorizeCronRequest(req({ authorization: "Bearer cron-secret" }))).toBe(true);
    });

    it("accepts the internal secret as a Bearer token", () => {
      expect(authorizeCronRequest(req({ authorization: "Bearer triage-secret" }))).toBe(true);
    });

    it("accepts the internal secret via x-internal-triage-secret", () => {
      expect(authorizeCronRequest(req({ "x-internal-triage-secret": "triage-secret" }))).toBe(
        true,
      );
    });

    it("rejects a wrong secret", () => {
      expect(authorizeCronRequest(req({ authorization: "Bearer nope" }))).toBe(false);
    });

    it("rejects an unauthenticated request", () => {
      expect(authorizeCronRequest(req())).toBe(false);
    });

    it("fails closed when no secrets are configured", () => {
      delete process.env.CRON_SECRET;
      delete process.env.INTERNAL_TRIAGE_SECRET;
      expect(authorizeCronRequest(req({ authorization: "Bearer anything" }))).toBe(false);
      expect(authorizeCronRequest(req())).toBe(false);
    });
  });

  describe("authorizeInternalRequest", () => {
    it("does not accept the cron secret", () => {
      expect(authorizeInternalRequest(req({ authorization: "Bearer cron-secret" }))).toBe(false);
    });

    it("accepts the internal secret by either transport", () => {
      expect(authorizeInternalRequest(req({ authorization: "Bearer triage-secret" }))).toBe(true);
      expect(
        authorizeInternalRequest(req({ "x-internal-triage-secret": "triage-secret" })),
      ).toBe(true);
    });
  });
});
