/** @jest-environment node */

import { applyMintTransition } from "./mint-queue";

jest.mock("@/lib/supabase-rest", () => ({
  supabaseRestConfig: () => ({ url: "https://sb.test", serviceKey: "svc" }),
  serviceAuthHeaders: () => ({ apikey: "svc" }),
}));

type Call = { url: string; init?: RequestInit };

function mockFetch(priorMetadata: unknown, patchRows: unknown[] = [{ id: "r1" }]) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (!init?.method) {
      return new Response(JSON.stringify([{ metadata: priorMetadata }]), { status: 200 });
    }
    return new Response(JSON.stringify(patchRows), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

function patchBody(calls: Call[]) {
  const patch = calls.find((c) => c.init?.method === "PATCH");
  return JSON.parse(String(patch?.init?.body));
}

describe("applyMintTransition", () => {
  it("increments attempts on every minting claim", async () => {
    const calls = mockFetch({ mint: { attempts: 1 }, sessionId: "keep-me" });

    await applyMintTransition("r1", { status: "minting" });

    const body = patchBody(calls);
    expect(body.onchain_mint_status).toBe("minting");
    expect(body.metadata.mint.attempts).toBe(2);
    expect(body.metadata.sessionId).toBe("keep-me");
  });

  it("does not increment attempts when re-queueing after a failure", async () => {
    const calls = mockFetch({ mint: { attempts: 2 } });

    await applyMintTransition("r1", { status: "queued", reason: "rpc down" });

    const body = patchBody(calls);
    expect(body.metadata.mint.attempts).toBe(2);
    expect(body.metadata.mint.lastReason).toBe("rpc down");
  });

  it("filters the PATCH on the expected status and reports a lost race", async () => {
    const calls = mockFetch({}, []);

    const claimed = await applyMintTransition(
      "r1",
      { status: "minting" },
      { expectStatus: "queued" },
    );

    expect(claimed).toBe(false);
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toContain("onchain_mint_status=eq.queued");
  });

  it("reports a won race", async () => {
    mockFetch({}, [{ id: "r1" }]);
    await expect(
      applyMintTransition("r1", { status: "minting" }, { expectStatus: "queued" }),
    ).resolves.toBe(true);
  });
});
