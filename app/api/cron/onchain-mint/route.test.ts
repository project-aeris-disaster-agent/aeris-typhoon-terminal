/** @jest-environment node */
export {};

/**
 * Regression coverage for the cron auth gate. The route previously skipped
 * authorization entirely when CRON_SECRET was unset, leaving the minting
 * endpoint open on any deploy missing that env var. These tests lock in the
 * secure-by-default behavior: no configured secret => always 401.
 */

const mintStaleQueuedReports = jest.fn();

jest.mock("@/services/onchain-mint-worker", () => ({
  mintStaleQueuedReports: (...args: unknown[]) => mintStaleQueuedReports(...args),
}));

function makeRequest(authorization?: string) {
  return new Request("http://localhost/api/cron/onchain-mint", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/cron/onchain-mint auth", () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    mintStaleQueuedReports.mockReset();
    mintStaleQueuedReports.mockResolvedValue({
      attempted: 0,
      results: [],
      reachedDeadline: false,
    });
    process.env = { ...env };
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_TRIAGE_SECRET;
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns 401 (secure-by-default) when no secret is configured", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mintStaleQueuedReports).not.toHaveBeenCalled();
  });

  it("returns 401 when no secret is configured even if a bearer token is sent", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(401);
    expect(mintStaleQueuedReports).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is set but the token is missing or wrong", async () => {
    process.env.CRON_SECRET = "right-secret";
    const { GET } = await import("./route");
    expect((await GET(makeRequest())).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    expect(mintStaleQueuedReports).not.toHaveBeenCalled();
  });

  it("authorizes with a matching CRON_SECRET bearer token", async () => {
    process.env.CRON_SECRET = "right-secret";
    const { GET } = await import("./route");
    const res = await GET(makeRequest("Bearer right-secret"));
    expect(res.status).toBe(200);
    expect(mintStaleQueuedReports).toHaveBeenCalledTimes(1);
  });

  it("authorizes with a matching INTERNAL_TRIAGE_SECRET bearer token", async () => {
    process.env.INTERNAL_TRIAGE_SECRET = "triage-secret";
    const { GET } = await import("./route");
    const res = await GET(makeRequest("Bearer triage-secret"));
    expect(res.status).toBe(200);
    expect(mintStaleQueuedReports).toHaveBeenCalledTimes(1);
  });
});
