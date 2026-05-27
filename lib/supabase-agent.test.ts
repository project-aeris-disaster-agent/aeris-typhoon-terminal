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
