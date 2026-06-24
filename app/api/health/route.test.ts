/** @jest-environment node */
export {};

describe("/api/health", () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };
    delete process.env.VERCEL_ENV;
    delete process.env.DASHBOARD_AUTH_DISABLED;
  });

  afterEach(() => {
    process.env = env;
  });

  function setProdEnv() {
    process.env.VERCEL_ENV = "production";
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "token";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.CRON_SECRET = "cron-secret";
  }

  it("returns 200 on production when required env vars are set", async () => {
    setProdEnv();
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(body.checks.missing).toEqual([]);
    expect(body.checks.cron).toBe("configured");
  });

  it("returns 503 on production when KV is missing", async () => {
    setProdEnv();
    delete process.env.KV_REST_API_URL;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.missing).toContain("KV_REST_API_URL");
  });

  it("returns 503 on production when CRON_SECRET is missing", async () => {
    setProdEnv();
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.missing).toContain("CRON_SECRET");
  });

  it("warns when MINDS_NOTIFY_ENABLED without builder credentials", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "true";
    delete process.env.MINDS_BUILDER_API_KEY;
    delete process.env.MINDS_AERIS_MIND_ID;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.checks.warnings.some((w: string) => w.includes("MINDS_NOTIFY_ENABLED")),
    ).toBe(true);
  });

  it("returns 200 in non-production even when KV is missing", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.warnings.some((w: string) => w.includes("KV"))).toBe(true);
  });

  it("skips Supabase requirements when auth is disabled", async () => {
    setProdEnv();
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.auth).toBe("disabled");
  });
});
