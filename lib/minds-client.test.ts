/** @jest-environment node */

import {
  getCognitionStatus,
  getMindsClient,
  mindsClientAvailable,
  resetMindsClientForTests,
  describeMindsApiError,
  sendWatchMessageConfirmed,
} from "@/lib/minds-client";
import { MindsApiError } from "@animocabrands/minds-client-lib";

describe("minds-client", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    resetMindsClientForTests();
    delete process.env.MINDS_BUILDER_API_KEY;
    delete process.env.MINDS_AERIS_MIND_ID;
  });

  afterEach(() => {
    process.env = env;
    resetMindsClientForTests();
  });

  it("reports unavailable when builder key or mind id is missing", () => {
    expect(mindsClientAvailable()).toBe(false);

    process.env.MINDS_BUILDER_API_KEY = "key";
    expect(mindsClientAvailable()).toBe(false);

    process.env.MINDS_AERIS_MIND_ID = "mind-1";
    expect(mindsClientAvailable()).toBe(true);
  });

  it("maps MindsApiError status codes to operator messages", () => {
    expect(
      describeMindsApiError(
        new MindsApiError({
          status: 401,
          code: "unauthorized",
          message: "bad key",
        }),
      ),
    ).toContain("missing, invalid, or revoked");

    expect(
      describeMindsApiError(
        new MindsApiError({
          status: 429,
          code: "rate_limit",
          message: "slow down",
        }),
      ),
    ).toContain("rate limit");
  });

  it("sendWatchMessageConfirmed reports confirmed=true when the Mind replies", async () => {
    process.env.MINDS_BUILDER_API_KEY = "key";
    process.env.MINDS_AERIS_MIND_ID = "mind-1";

    const client = getMindsClient();
    (client.ensureConversation as jest.Mock).mockResolvedValue({});
    (client.sendMessage as jest.Mock).mockResolvedValue({ fingerprint: "fp-9" });
    (client.waitForReply as jest.Mock).mockResolvedValue({
      timedOut: false,
      reply: { messageText: "On it." },
    });

    const result = await sendWatchMessageConfirmed({
      messageText: "critical alert",
      timeoutMs: 5_000,
    });

    expect(result).toEqual({
      fingerprint: "fp-9",
      confirmed: true,
      replyText: "On it.",
    });
    expect((client.waitForReply as jest.Mock).mock.calls[0][0]).toMatchObject({
      timeoutMs: 5_000,
      afterFingerprint: "fp-9",
    });
  });

  it("sendWatchMessageConfirmed reports confirmed=false on timeout", async () => {
    process.env.MINDS_BUILDER_API_KEY = "key";
    process.env.MINDS_AERIS_MIND_ID = "mind-1";

    const client = getMindsClient();
    (client.ensureConversation as jest.Mock).mockResolvedValue({});
    (client.sendMessage as jest.Mock).mockResolvedValue({ fingerprint: "fp-9" });
    (client.waitForReply as jest.Mock).mockResolvedValue({ timedOut: true });

    const result = await sendWatchMessageConfirmed({ messageText: "alert" });
    expect(result).toEqual({ fingerprint: "fp-9", confirmed: false });
  });

  it("getCognitionStatus flags balances below the warn threshold", async () => {
    process.env.MINDS_BUILDER_API_KEY = "key";
    process.env.MINDS_AERIS_MIND_ID = "mind-1";
    process.env.MINDS_COGNITION_WARN_THRESHOLD = "50";

    const client = getMindsClient();
    (client.getCognitionBalance as jest.Mock).mockResolvedValue({
      mindId: "mind-1",
      cognition: 12,
    });

    const status = await getCognitionStatus();
    expect(status.low).toBe(true);
    expect(status.warnThreshold).toBe(50);
    expect(status.balance.cognition).toBe(12);
  });
});
