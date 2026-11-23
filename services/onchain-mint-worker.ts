/**
 * Phase 6.3 - Mint worker.
 *
 * Pulls queued disaster reports, pins Hypercerts-shaped metadata to IPFS,
 * and mints an ERC-1155 token per report on the active SKALE-Base network.
 *
 * Mirrors the deadline-aware batch pattern used by the triage runner:
 * each call passes a wall-clock deadline and a safety margin so we abort
 * cleanly under Vercel function time limits.
 */

import {
  applyMintTransition,
  attemptCountFor,
  getReportForMint,
  listQueuedMintReports,
  listStaleQueuedMintReports,
  mintBookkeeping,
  type MintTransitionUpdate,
} from "@/lib/onchain/mint-queue";
import {
  buildAerisReportHypercert,
  reportToTokenId,
} from "@/lib/onchain/hypercert-metadata";
import { pinJson } from "@/lib/onchain/ipfs";
import {
  generateCommitmentSalt,
  coarsenPosition,
  computeGeoCommitment,
  computeDescriptionCommitment,
  computePhotoCommitment,
} from "@/lib/onchain/commitments";
import {
  getMintClient,
  mintClientAvailable,
  mintReport,
  isAlreadyMinted,
} from "@/lib/onchain/mint-client";
import { explorerTxUrl } from "@/lib/onchain/skale-base";
import type { PublicReport } from "@/lib/supabase-reports";
import type { Address } from "viem";

/**
 * Compute a commitment hash of the citizen's evidence photo, if any. The raw
 * photo is never minted or pinned to IPFS (see lib/onchain/commitments.ts) -
 * the token metadata's `image` always falls back to the static badge.
 *
 * Never throws: a fetch/hash failure just means no photo_commitment trait is
 * attached, so a missing/slow photo host never blocks a mint.
 */
async function resolvePhotoCommitment(
  report: PublicReport,
  salt: string,
): Promise<string | undefined> {
  const photoUrl = report.photoUrl;
  if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) return undefined;

  // Reuse the existing moderation workflow: only commit a photo hash once the
  // report is verified and not hidden/flagged. (Mint already requires verified.)
  const moderation = report.moderationStatus;
  const moderationOk = moderation !== "hidden" && moderation !== "needs_review";
  if (report.verificationStatus !== "verified" || !moderationOk) {
    return undefined;
  }

  return computePhotoCommitment(photoUrl, salt);
}

export type MintWorkerOptions = {
  limit?: number;
  deadlineAt: number;
  safetyMarginMs?: number;
  maxAttempts?: number;
};

export type MintWorkerOutcome = {
  reportId: string;
  status: "minted" | "failed" | "skipped" | "already_minted";
  txHash?: string;
  tokenId?: string;
  explorerUrl?: string;
  reason?: string;
};

export type MintWorkerSummary = {
  attempted: number;
  results: MintWorkerOutcome[];
  reachedDeadline: boolean;
};

const DEFAULT_LIMIT = 5;
const DEFAULT_SAFETY_MS = 7_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function nowMs() {
  return Date.now();
}

/**
 * Push-path entrypoint - mint a single report by id.
 *
 * Called by `/api/internal/onchain-mint` when invoked from the Supabase
 * Database Webhook on `disaster_reports` transitioning to `queued`. We
 * verify the row is still queued (it may have been picked up by the cron
 * sweep already) before doing any work.
 */
export async function mintReportById(
  reportId: string,
  opts: { maxAttempts?: number } = {},
): Promise<MintWorkerOutcome> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!mintClientAvailable()) {
    return {
      reportId,
      status: "skipped",
      reason: "mint-client-not-configured",
    };
  }
  const report = await getReportForMint(reportId);
  if (!report) {
    return { reportId, status: "skipped", reason: "report-not-found" };
  }
  const status = report.onchain?.mint?.status;
  // "minting" is passed through so mintOne can reclaim a stale orphan; a
  // fresh in-flight claim is skipped there.
  if (status !== "queued" && status !== "minting") {
    return {
      reportId,
      status: "skipped",
      reason: `mint-status=${status ?? "unknown"}`,
    };
  }
  const client = getMintClient();
  return mintOne(client, report, maxAttempts);
}

/**
 * Cron safety-net entrypoint - sweep rows that have been queued longer than
 * `minAgeSeconds` so we only act on what the push path missed.
 *
 * Falls back to the unfiltered queue when `minAgeSeconds <= 0`.
 */
export async function mintStaleQueuedReports(
  opts: MintWorkerOptions & { minAgeSeconds?: number },
): Promise<MintWorkerSummary> {
  const minAge = opts.minAgeSeconds ?? 120;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const safety = opts.safetyMarginMs ?? DEFAULT_SAFETY_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const results: MintWorkerOutcome[] = [];

  if (!mintClientAvailable()) {
    return {
      attempted: 0,
      results: [
        { reportId: "", status: "skipped", reason: "mint-client-not-configured" },
      ],
      reachedDeadline: false,
    };
  }

  const queue =
    minAge > 0
      ? await listStaleQueuedMintReports(minAge, limit)
      : await listQueuedMintReports(limit);
  if (queue.length === 0) {
    return { attempted: 0, results, reachedDeadline: false };
  }

  const client = getMintClient();
  let reachedDeadline = false;
  for (const report of queue) {
    if (nowMs() + safety > opts.deadlineAt) {
      reachedDeadline = true;
      break;
    }
    results.push(await mintOne(client, report, maxAttempts));
  }
  return { attempted: results.length, results, reachedDeadline };
}

export async function mintQueuedReports(
  opts: MintWorkerOptions,
): Promise<MintWorkerSummary> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const safety = opts.safetyMarginMs ?? DEFAULT_SAFETY_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const results: MintWorkerOutcome[] = [];

  if (!mintClientAvailable()) {
    return {
      attempted: 0,
      results: [
        {
          reportId: "",
          status: "skipped",
          reason: "mint-client-not-configured",
        },
      ],
      reachedDeadline: false,
    };
  }

  const queue = await listQueuedMintReports(limit);
  if (queue.length === 0) {
    return { attempted: 0, results, reachedDeadline: false };
  }

  const client = getMintClient();
  let reachedDeadline = false;

  for (const report of queue) {
    if (nowMs() + safety > opts.deadlineAt) {
      reachedDeadline = true;
      break;
    }

    const outcome = await mintOne(client, report, maxAttempts);
    results.push(outcome);
  }

  return { attempted: results.length, results, reachedDeadline };
}

/**
 * A row left in `minting` longer than this is assumed orphaned by a function
 * that timed out mid-mint, and may be reclaimed. Comfortably above the
 * longest mint route budget (60 s).
 */
export const STUCK_MINTING_MS = 10 * 60_000;

/** Minimum wait before retrying a failed attempt: 1 min, 2 min, 4 min, ... */
export function retryBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return 60_000 * 2 ** Math.min(attempts - 1, 6);
}

async function mintOne(
  client: ReturnType<typeof getMintClient>,
  report: PublicReport,
  maxAttempts: number,
): Promise<MintWorkerOutcome> {
  const attempts = await attemptCountFor(report.id);
  if (attempts >= maxAttempts) {
    return {
      reportId: report.id,
      status: "failed",
      reason: `attempts-exhausted (${attempts}/${maxAttempts})`,
    };
  }

  const currentStatus = report.onchain?.mint?.status ?? "queued";
  const { lastUpdatedAt } = mintBookkeeping(report);
  const sinceLast =
    lastUpdatedAt !== undefined ? nowMs() - lastUpdatedAt : Number.POSITIVE_INFINITY;

  if (currentStatus === "minting" && sinceLast < STUCK_MINTING_MS) {
    // Another invocation is mid-mint. Leave it alone.
    return { reportId: report.id, status: "skipped", reason: "mint-in-flight" };
  }
  if (currentStatus === "queued" && sinceLast < retryBackoffMs(attempts)) {
    // A failed attempt re-queued this row moments ago, which re-fired the
    // pg_net webhook. Don't retry straight away; the cron sweep picks it up.
    return { reportId: report.id, status: "skipped", reason: "retry-backoff" };
  }

  // Claim the row conditionally so two workers can't mint it concurrently.
  const claimed = await applyMintTransition(
    report.id,
    { status: "minting" },
    { expectStatus: currentStatus },
  );
  if (!claimed) {
    return { reportId: report.id, status: "skipped", reason: "claimed-elsewhere" };
  }

  try {
    const tokenIdStr = reportToTokenId(report.id);
    const tokenId = BigInt(tokenIdStr);

    if (await isAlreadyMinted(client, tokenId)) {
      await applyMintTransition(report.id, {
        status: "minted",
        network: client.network.key,
        chainId: client.network.chainId,
        tokenId: tokenIdStr,
        mintedAt: new Date().toISOString(),
        reason: "already-minted-on-chain",
      });
      return {
        reportId: report.id,
        status: "already_minted",
        tokenId: tokenIdStr,
      };
    }

    const verifiedAt = report.reviewedAt ?? new Date().toISOString();
    const verifiedAtUnix = Math.floor(new Date(verifiedAt).getTime() / 1000);
    const contributorAddress =
      report.onchain?.proxyWallet?.address ?? client.serviceAddress;

    // Salted commitments replace the exact GPS/description/photo that used to
    // be minted directly. The salt is generated fresh per mint attempt and
    // only persisted (via applyMintTransition below) once the mint succeeds,
    // so an authorized party can later reveal-and-verify the exact values
    // without them ever having been public. See lib/onchain/commitments.ts.
    const salt = generateCommitmentSalt();
    const coarsePosition = coarsenPosition(report.position);
    const geoCommitment = await computeGeoCommitment(report.position, salt);
    const descriptionCommitment = await computeDescriptionCommitment(
      report.description ?? "",
      salt,
    );
    const photoCommitment = await resolvePhotoCommitment(report, salt);

    const metadata = buildAerisReportHypercert({
      report,
      contributorAddress,
      verifiedAtUnix,
      coarsePosition,
      geoCommitment,
      descriptionCommitment,
      photoCommitment,
    });

    const pinned = await pinJson(metadata, `aeris-report-${report.id}`);

    const result = await mintReport(client, {
      to: client.serviceAddress as Address,
      tokenId,
      tokenUri: pinned.uri,
      reportId: report.id,
    });

    const txUpdate: MintTransitionUpdate = {
      status: "minted",
      network: client.network.key,
      chainId: client.network.chainId,
      txHash: result.txHash,
      tokenId: tokenIdStr,
      mintedAt: new Date().toISOString(),
      reason: pinned.backend === "dev-skip" ? "dev-skip-ipfs" : null,
      geoSalt: salt,
      geoCommitment,
      descriptionCommitment,
      photoCommitment,
    };
    const persisted = await applyMintTransition(report.id, txUpdate);
    if (!persisted) {
      // The chain write already succeeded - never surface this as a failed
      // mint (that would drive a pointless retry). But the Supabase row is
      // now desynced from on-chain state (most likely cause: the
      // geo_salt/geo_commitment/description_commitment/photo_commitment
      // columns from supabase/migrations/20260701000000_report_privacy_commitments.sql
      // haven't been applied yet). Surface loudly so it doesn't go unnoticed.
      console.error(
        `[onchain-mint] report=${report.id} minted on-chain (tx=${result.txHash}, tokenId=${tokenIdStr}) but failed to persist to Supabase - manual reconciliation needed`,
      );
    }

    return {
      reportId: report.id,
      status: "minted",
      txHash: result.txHash,
      tokenId: tokenIdStr,
      explorerUrl: result.txHash
        ? explorerTxUrl(client.network, result.txHash)
        : undefined,
    };
  } catch (err) {
    const message = (err as Error).message ?? "mint-failed";
    const attemptsAfter = attempts + 1;
    const finalStatus =
      attemptsAfter >= maxAttempts ? ("failed" as const) : ("queued" as const);
    // Surface to stderr so the failure appears in Vercel function logs and can
    // drive log-based alerting. The DB transition below is the durable record.
    console.error(
      `[onchain-mint] report=${report.id} attempt=${attemptsAfter}/${maxAttempts} status=${finalStatus}: ${message}`,
    );
    await applyMintTransition(report.id, {
      status: finalStatus,
      reason: message.slice(0, 280),
    });
    return {
      reportId: report.id,
      status: "failed",
      reason: message,
    };
  }
}
