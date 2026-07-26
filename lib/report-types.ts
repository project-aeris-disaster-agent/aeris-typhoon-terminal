/**
 * Report shapes shared by the server data layer (`lib/supabase-reports.ts`)
 * and the browser client (`services/reports-client.ts`).
 *
 * These three declarations were previously maintained twice, verbatim, on
 * either side of the API boundary — including a 23-line `onchain` block that
 * had to be edited in lockstep. This module has no runtime dependencies and is
 * safe to import from either side.
 */

export type AiPriority = "pending" | "urgent" | "low_priority" | "rejected";

export type ReportReviewAction =
  | "verify"
  | "reject"
  | "duplicate"
  | "hide"
  | "unhide"
  | "needs_review"
  | "unverify"
  | "note"
  | "confidence_adjust";

/** On-chain mint state carried on a report, as serialized by /api/reports. */
export type ReportOnchainInfo = {
  proxyWallet?: {
    id?: string;
    address?: string;
    network: string;
    chainId: number;
  };
  mint: {
    network: string;
    chainId: number;
    status: string;
    txHash?: string;
    tokenId?: string;
    mintedAt?: string;
  };
};
