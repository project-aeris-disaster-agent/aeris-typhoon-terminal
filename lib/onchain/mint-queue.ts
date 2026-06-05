/**
 * Phase 6.3 - Supabase helpers for the mint queue.
 *
 * Reads:
 *  - listQueuedMintReports(limit): rows where onchain_mint_status='queued'.
 *
 * Writes:
 *  - markMintInFlight(reportId): queued -> minting.
 *  - markMintSucceeded(reportId, ...): minting -> minted, store tx + token id.
 *  - markMintFailed(reportId, reason): minting -> failed (or queued for retry).
 *
 * Uses the same PostgREST + service-role pattern as the rest of the codebase
 * so it works on Edge or Node runtimes alike.
 */

import type { PublicReport } from "@/lib/supabase-reports";

const MINT_COLUMNS = [
  "id",
  "report_message_id",
  "source_app",
  "category",
  "description",
  "longitude",
  "latitude",
  "photo_url",
  "verification_status",
  "moderation_status",
  "phone_verification_status",
  "proxy_wallet_address",
  "onchain_network",
  "onchain_chain_id",
  "onchain_mint_status",
  "onchain_tx_hash",
  "onchain_token_id",
  "onchain_minted_at",
  "ai_priority",
  "dedupe_hash",
  "metadata",
  "reviewed_at",
  "created_at",
].join(",");

type Row = Record<string, unknown>;

function cfg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function headers(serviceKey: string) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

function rowToPublic(row: Row): PublicReport {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    messageId:
      typeof row.report_message_id === "string"
        ? row.report_message_id
        : typeof metadata.messageId === "string"
          ? (metadata.messageId as string)
          : undefined,
    category: String(row.category),
    description: String(row.description),
    position: [Number(row.longitude), Number(row.latitude)],
    photoUrl: typeof row.photo_url === "string" ? row.photo_url : undefined,
    createdAt: String(row.created_at),
    confirmations: 0,
    sourceApp: typeof row.source_app === "string" ? row.source_app : undefined,
    verificationStatus:
      typeof row.verification_status === "string" ? row.verification_status : undefined,
    moderationStatus:
      typeof row.moderation_status === "string" ? row.moderation_status : undefined,
    phoneVerificationStatus:
      typeof row.phone_verification_status === "string"
        ? row.phone_verification_status
        : undefined,
    aiPriority:
      typeof row.ai_priority === "string"
        ? (row.ai_priority as PublicReport["aiPriority"])
        : undefined,
    dedupeHash: typeof row.dedupe_hash === "string" ? row.dedupe_hash : undefined,
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : undefined,
    sessionId:
      typeof metadata.sessionId === "string" && (metadata.sessionId as string).length > 0
        ? (metadata.sessionId as string)
        : undefined,
    metadata,
    onchain: {
      proxyWallet: row.proxy_wallet_address
        ? {
            address: row.proxy_wallet_address as string,
            network: (row.onchain_network as string) ?? "skale-base-testnet",
            chainId: (row.onchain_chain_id as number) ?? 324705682,
          }
        : undefined,
      mint: {
        network: (row.onchain_network as string) ?? "skale-base-testnet",
        chainId: (row.onchain_chain_id as number) ?? 324705682,
        status: (row.onchain_mint_status as string) ?? "not_started",
        txHash: (row.onchain_tx_hash as string | null) ?? undefined,
        tokenId: (row.onchain_token_id as string | null) ?? undefined,
        mintedAt: (row.onchain_minted_at as string | null) ?? undefined,
      },
    },
  };
}

/**
 * Fetch a single report row by id (regardless of its current mint status).
 *
 * Used by the push path (Supabase Database Webhook -> /api/internal/onchain-mint)
 * so we can target the exact row that just transitioned to `queued` without
 * scanning the whole queue. The caller is expected to verify the row's
 * status before acting on it.
 */
export async function getReportForMint(
  reportId: string,
): Promise<PublicReport | null> {
  const c = cfg();
  if (!c) return null;
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("select", MINT_COLUMNS);
  url.searchParams.set("id", `eq.${reportId}`);
  url.searchParams.set("limit", "1");
  const res = await fetch(url.toString(), {
    headers: headers(c.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Row[];
  if (!rows[0]) return null;
  return rowToPublic(rows[0]);
}

/**
 * Sweep helper used by the safety-net cron. Only return rows that have been
 * sitting in `queued` for longer than `minAgeSeconds` so we don't race the
 * push path that handles fresh rows within ~1s of the trigger firing.
 */
export async function listStaleQueuedMintReports(
  minAgeSeconds: number,
  limit = 10,
): Promise<PublicReport[]> {
  const c = cfg();
  if (!c) return [];
  const cutoffIso = new Date(Date.now() - minAgeSeconds * 1000).toISOString();
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("select", MINT_COLUMNS);
  url.searchParams.set("onchain_mint_status", "eq.queued");
  // updated/created comparison: use created_at so freshly-queued rows are
  // skipped until the webhook has had a chance to fire.
  url.searchParams.set("created_at", `lte.${cutoffIso}`);
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", String(Math.min(Math.max(1, limit), 50)));
  const res = await fetch(url.toString(), {
    headers: headers(c.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Row[];
  return rows.map(rowToPublic);
}

const VERIFIED_PENDING_MINT_STATUSES = [
  "not_started",
  "pending_phone",
  "pending_review",
  "failed",
  "queued",
] as const;

const VERIFIED_QUEUEABLE_MINT_STATUSES = [
  "not_started",
  "pending_phone",
  "pending_review",
  "failed",
] as const;

export function isVerifiedPendingMint(status: string | undefined | null): boolean {
  if (!status || status === "minted" || status === "minting") return false;
  return (VERIFIED_PENDING_MINT_STATUSES as readonly string[]).includes(status);
}

/**
 * Count verified disaster reports that are eligible for on-chain mint but not
 * yet confirmed on-chain (`minted` / in-flight `minting`).
 */
export async function countVerifiedPendingMint(): Promise<number> {
  const c = cfg();
  if (!c) return 0;
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("select", "id");
  url.searchParams.set("verification_status", "eq.verified");
  url.searchParams.set(
    "onchain_mint_status",
    `in.(${VERIFIED_PENDING_MINT_STATUSES.join(",")})`,
  );
  const res = await fetch(url.toString(), {
    headers: {
      ...headers(c.serviceKey),
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!res.ok) return 0;
  const range = res.headers.get("content-range");
  if (!range) return 0;
  const match = /\/(\d+)$/.exec(range);
  return match ? Number(match[1]) : 0;
}

/**
 * Transition all verified, not-yet-minted rows into `queued` so the mint worker
 * (or Supabase push webhook) can pick them up.
 */
export async function queueVerifiedReportsForMint(): Promise<number> {
  const c = cfg();
  if (!c) return 0;
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("verification_status", "eq.verified");
  url.searchParams.set(
    "onchain_mint_status",
    `in.(${VERIFIED_QUEUEABLE_MINT_STATUSES.join(",")})`,
  );
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...headers(c.serviceKey),
      prefer: "return=representation",
    },
    body: JSON.stringify({ onchain_mint_status: "queued" }),
  });
  if (!res.ok) return 0;
  const rows = (await res.json()) as Row[];
  return rows.length;
}

export async function listQueuedMintReports(limit = 10): Promise<PublicReport[]> {
  const c = cfg();
  if (!c) return [];
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("select", MINT_COLUMNS);
  url.searchParams.set("onchain_mint_status", "eq.queued");
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", String(Math.min(Math.max(1, limit), 50)));

  const res = await fetch(url.toString(), {
    headers: headers(c.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Row[];
  return rows.map(rowToPublic);
}

export type MintTransitionUpdate = {
  status: "queued" | "minting" | "minted" | "failed";
  network?: string;
  chainId?: number;
  txHash?: string | null;
  tokenId?: string | null;
  mintedAt?: string | null;
  reason?: string | null;
};

export async function applyMintTransition(
  reportId: string,
  update: MintTransitionUpdate,
): Promise<boolean> {
  const c = cfg();
  if (!c) return false;
  const payload: Record<string, unknown> = {
    onchain_mint_status: update.status,
  };
  if (update.network !== undefined) payload.onchain_network = update.network;
  if (update.chainId !== undefined) payload.onchain_chain_id = update.chainId;
  if (update.txHash !== undefined) payload.onchain_tx_hash = update.txHash;
  if (update.tokenId !== undefined) payload.onchain_token_id = update.tokenId;
  if (update.mintedAt !== undefined) payload.onchain_minted_at = update.mintedAt;

  // We also stamp a small JSON note inside metadata for failure reasons /
  // attempt counts, without overwriting the rest of metadata.
  if (update.reason || update.status === "failed" || update.status === "minted") {
    payload.metadata = {
      // Postgres JSONB column - PostgREST will coalesce on the server with
      // the `Prefer: resolution=merge-duplicates` header only when targeting
      // upserts. For a column-level merge we read-modify-write below.
    };
  }

  // Read-modify-write metadata so we can carry counters + reasons.
  let mergedMetadata: Record<string, unknown> | null = null;
  if (payload.metadata) {
    const readUrl = new URL(`${c.url}/rest/v1/disaster_reports`);
    readUrl.searchParams.set("select", "metadata");
    readUrl.searchParams.set("id", `eq.${reportId}`);
    readUrl.searchParams.set("limit", "1");
    const readRes = await fetch(readUrl.toString(), {
      headers: headers(c.serviceKey),
      cache: "no-store",
    });
    if (readRes.ok) {
      const rows = (await readRes.json()) as Array<{ metadata: Record<string, unknown> | null }>;
      const prior =
        rows[0]?.metadata && typeof rows[0].metadata === "object"
          ? (rows[0].metadata as Record<string, unknown>)
          : {};
      const mint =
        prior.mint && typeof prior.mint === "object"
          ? (prior.mint as Record<string, unknown>)
          : {};
      const attempts = Number(mint.attempts ?? 0);
      mergedMetadata = {
        ...prior,
        mint: {
          ...mint,
          lastStatus: update.status,
          lastReason: update.reason ?? null,
          lastUpdatedAt: new Date().toISOString(),
          attempts:
            update.status === "minting" ? attempts + 1 : attempts,
          ...(update.status === "minted"
            ? {
                txHash: update.txHash ?? null,
                tokenId: update.tokenId ?? null,
                network: update.network ?? null,
                chainId: update.chainId ?? null,
                mintedAt: update.mintedAt ?? null,
              }
            : {}),
        },
      };
      payload.metadata = mergedMetadata;
    } else {
      delete payload.metadata;
    }
  }

  const patchUrl = new URL(`${c.url}/rest/v1/disaster_reports`);
  patchUrl.searchParams.set("id", `eq.${reportId}`);
  const res = await fetch(patchUrl.toString(), {
    method: "PATCH",
    headers: { ...headers(c.serviceKey), prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function attemptCountFor(reportId: string): Promise<number> {
  const c = cfg();
  if (!c) return 0;
  const url = new URL(`${c.url}/rest/v1/disaster_reports`);
  url.searchParams.set("select", "metadata");
  url.searchParams.set("id", `eq.${reportId}`);
  url.searchParams.set("limit", "1");
  const res = await fetch(url.toString(), {
    headers: headers(c.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return 0;
  const rows = (await res.json()) as Array<{ metadata: Record<string, unknown> | null }>;
  const meta = rows[0]?.metadata ?? {};
  const mint =
    meta && typeof meta === "object" && meta.mint && typeof meta.mint === "object"
      ? (meta.mint as Record<string, unknown>)
      : {};
  return Number(mint.attempts ?? 0);
}
