/**
 * Focused tests for the optional-id pass-through added to
 * insertUserAgentMessage / insertAssistantAgentMessage.
 */

const ORIGINAL_FETCH = global.fetch;

describe("supabase-agent id pass-through", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-test";
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("forwards an optional id in the PostgREST body for user inserts", async () => {
    const captured: { body?: string } = {};
    global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      const i = init as { body?: string };
      captured.body = i.body;
      return {
        ok: true,
        status: 201,
        json: async () => [
          {
            id: "11111111-1111-4111-8111-111111111111",
            role: "user",
            source: "user",
            content: "hello",
            report_id: null,
            disaster_report_id: null,
            session_id: null,
            operator_name: null,
            responded_to_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { insertUserAgentMessage } = await import("@/lib/supabase-agent");
    const row = await insertUserAgentMessage("hello", {
      id: "11111111-1111-4111-8111-111111111111",
    });

    expect(row).not.toBeNull();
    expect(captured.body).toBeTruthy();
    const parsed = JSON.parse(captured.body!) as Record<string, unknown>;
    expect(parsed.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("hello");
  });

  it("omits the id field when none is supplied (assistant insert)", async () => {
    const captured: { body?: string } = {};
    global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      const i = init as { body?: string };
      captured.body = i.body;
      return {
        ok: true,
        status: 201,
        json: async () => [
          {
            id: "22222222-2222-4222-8222-222222222222",
            role: "assistant",
            source: "assistant",
            content: "ack",
            report_id: null,
            disaster_report_id: null,
            session_id: null,
            operator_name: null,
            responded_to_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { insertAssistantAgentMessage } = await import("@/lib/supabase-agent");
    await insertAssistantAgentMessage("ack");

    const parsed = JSON.parse(captured.body!) as Record<string, unknown>;
    expect(parsed.id).toBeUndefined();
    expect(parsed.role).toBe("assistant");
  });
});

describe("AGENT AERIS history scoping", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-test";
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("derives a stable uuid-shaped key from a Privy DID", async () => {
    const { agentHistoryKey } = await import("@/lib/supabase-agent");
    const a = agentHistoryKey("did:privy:abc123");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(agentHistoryKey("did:privy:abc123")).toBe(a);
    expect(agentHistoryKey("did:privy:other")).not.toBe(a);
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(agentHistoryKey(uuid)).toBe(uuid);
  });

  it("reads with the service key and filters to the viewer's own history", async () => {
    const seen: { url?: string; apikey?: string } = {};
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      seen.url = String(url);
      seen.apikey = (init as { headers: Record<string, string> }).headers.apikey;
      return { ok: true, json: async () => [] } as unknown as Response;
    }) as unknown as typeof fetch;

    const { listAgentMessages, agentHistoryKey } = await import("@/lib/supabase-agent");
    await listAgentMessages(20, { userId: "did:privy:abc123" });

    expect(seen.apikey).toBe("service-key-test");
    const or = new URL(seen.url!).searchParams.get("or");
    expect(or).toBe(
      `(session_id.eq.${agentHistoryKey("did:privy:abc123")},source.eq.weather_report)`,
    );
  });

  it("returns only broadcasts when there is no signed-in viewer", async () => {
    let url = "";
    global.fetch = jest.fn(async (u: unknown) => {
      url = String(u);
      return { ok: true, json: async () => [] } as unknown as Response;
    }) as unknown as typeof fetch;

    const { listAgentMessages } = await import("@/lib/supabase-agent");
    await listAgentMessages(20);

    expect(new URL(url).searchParams.get("or")).toBe("(source.eq.weather_report)");
  });
});
