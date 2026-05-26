/** @jest-environment node */

import type { PublicReport } from "@/lib/supabase-reports";

jest.mock("@/lib/onchain/mint-queue", () => ({
  listQueuedMintReports: jest.fn(),
  applyMintTransition: jest.fn(),
  attemptCountFor: jest.fn(),
}));

jest.mock("@/lib/onchain/ipfs", () => ({
  pinJson: jest.fn(),
}));

jest.mock("@/lib/onchain/mint-client", () => ({
  mintClientAvailable: jest.fn(),
  getMintClient: jest.fn(),
  mintReport: jest.fn(),
  isAlreadyMinted: jest.fn(),
}));

import { mintQueuedReports } from "./onchain-mint-worker";
import * as queue from "@/lib/onchain/mint-queue";
import * as ipfs from "@/lib/onchain/ipfs";
import * as client from "@/lib/onchain/mint-client";

const mockedQueue = queue as jest.Mocked<typeof queue>;
const mockedIpfs = ipfs as jest.Mocked<typeof ipfs>;
const mockedClient = client as jest.Mocked<typeof client>;

const fakeClient = {
  network: { key: "skale-base-testnet", chainId: 324705682, rpcUrl: "x", explorerUrl: "y", chainIdHex: "0x1" as const, nativeToken: { symbol: "CREDIT", decimals: 18 } },
  contractAddress: "0xabc" as `0x${string}`,
  serviceAddress: "0xdef" as `0x${string}`,
  publicClient: {} as any,
  walletClient: {} as any,
};

function makeReport(id: string, overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    id,
    messageId: `AERIS-${id}`,
    category: "flood",
    description: "Flooding in Marikina",
    position: [121.1, 14.6],
    createdAt: "2026-05-27T01:00:00.000Z",
    reviewedAt: "2026-05-27T01:30:00.000Z",
    confirmations: 0,
    aiPriority: "urgent",
    verificationStatus: "verified",
    phoneVerificationStatus: "verified",
    onchain: {
      mint: {
        network: "skale-base-testnet",
        chainId: 324705682,
        status: "queued",
      },
    },
    ...overrides,
  };
}

describe("mintQueuedReports", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClient.mintClientAvailable.mockReturnValue(true);
    mockedClient.getMintClient.mockReturnValue(fakeClient as any);
    mockedClient.isAlreadyMinted.mockResolvedValue(false);
    mockedQueue.attemptCountFor.mockResolvedValue(0);
    mockedQueue.applyMintTransition.mockResolvedValue(true);
    mockedIpfs.pinJson.mockResolvedValue({
      uri: "ipfs://Qmtest",
      cid: "Qmtest",
      backend: "dev-skip",
    });
  });

  it("returns skipped when mint client is not configured", async () => {
    mockedClient.mintClientAvailable.mockReturnValue(false);
    const summary = await mintQueuedReports({
      deadlineAt: Date.now() + 60_000,
    });
    expect(summary.results[0].status).toBe("skipped");
    expect(summary.attempted).toBe(0);
  });

  it("mints each queued report and records tx + token id", async () => {
    mockedQueue.listQueuedMintReports.mockResolvedValue([
      makeReport("00000000-0000-0000-0000-000000000001"),
      makeReport("00000000-0000-0000-0000-000000000002"),
    ]);
    mockedClient.mintReport.mockImplementation(async (_c, args) => ({
      txHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
      tokenId: args.tokenId.toString(10),
      network: "skale-base-testnet",
      chainId: 324705682,
      to: args.to,
      alreadyMinted: false,
    }));

    const summary = await mintQueuedReports({
      deadlineAt: Date.now() + 60_000,
    });

    expect(summary.attempted).toBe(2);
    expect(summary.results.every((r) => r.status === "minted")).toBe(true);
    expect(mockedQueue.applyMintTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "minting" }),
    );
    expect(mockedQueue.applyMintTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "minted" }),
    );
  });

  it("short-circuits when token id was already minted on-chain", async () => {
    mockedQueue.listQueuedMintReports.mockResolvedValue([
      makeReport("00000000-0000-0000-0000-00000000000a"),
    ]);
    mockedClient.isAlreadyMinted.mockResolvedValue(true);

    const summary = await mintQueuedReports({
      deadlineAt: Date.now() + 60_000,
    });

    expect(summary.results[0].status).toBe("already_minted");
    expect(mockedClient.mintReport).not.toHaveBeenCalled();
  });

  it("respects the wall-clock deadline + safety margin", async () => {
    mockedQueue.listQueuedMintReports.mockResolvedValue([
      makeReport("00000000-0000-0000-0000-00000000000b"),
      makeReport("00000000-0000-0000-0000-00000000000c"),
    ]);
    // Deadline already in the past relative to safety margin -> stop immediately.
    const summary = await mintQueuedReports({
      deadlineAt: Date.now() - 1_000,
      safetyMarginMs: 0,
    });
    expect(summary.reachedDeadline).toBe(true);
    expect(summary.attempted).toBe(0);
  });

  it("falls back to failed status when mint throws beyond max attempts", async () => {
    mockedQueue.listQueuedMintReports.mockResolvedValue([
      makeReport("00000000-0000-0000-0000-00000000000d"),
    ]);
    mockedQueue.attemptCountFor.mockResolvedValue(2); // next attempt will be 3 == max
    mockedClient.mintReport.mockRejectedValue(new Error("rpc unreachable"));

    const summary = await mintQueuedReports({
      deadlineAt: Date.now() + 60_000,
      maxAttempts: 3,
    });

    expect(summary.results[0].status).toBe("failed");
    expect(mockedQueue.applyMintTransition).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
    );
  });
});
