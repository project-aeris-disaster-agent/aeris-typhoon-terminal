/**
 * Phase 6.1 / 7 - Hypercerts-shaped ERC-1155 token metadata for AERIS reports.
 *
 * This is intentionally "Hypercerts-shaped, not protocol-compliant". We reuse
 * the dimension names defined by the Hypercerts data model
 * (impact_scope, work_scope, work_timeframe, impact_timeframe,
 * contributors, rights) so a future migration to AT-Protocol-native
 * Hypercerts is straightforward, but we do not interact with the
 * Hypercerts contracts or PDS at this layer.
 *
 * https://docs.hypercerts.org/
 *
 * v2 (Phase 7): stops putting exact GPS, free-text description, and evidence
 * photos into public immutable metadata. Only a coarse position + salted
 * commitment hashes are minted; the salt and exact values live off-chain in
 * Supabase, revealable only through an authorized channel. See
 * lib/onchain/commitments.ts.
 */

import type { PublicReport } from "@/lib/supabase-reports";

export const AERIS_REPORT_HYPERCERT_VERSION = "aeris.report.v2";

export type AerisReportHypercert = {
  name: string;
  description: string;
  image: string;
  external_url: string;
  hypercert: {
    impact_scope: { name: string; value: string[] };
    work_scope: { name: string; value: string[] };
    work_timeframe: { name: string; value: [number, number] };
    impact_timeframe: { name: string; value: [number, number] };
    contributors: { name: string; value: string[] };
    rights: { name: string; value: string[] };
  };
  properties: Array<{ trait_type: string; value: string | number }>;
  /** Marker so downstream tools can detect the schema version we produced. */
  schema: typeof AERIS_REPORT_HYPERCERT_VERSION;
};

export type BuildHypercertInput = {
  report: PublicReport;
  /** Address that holds the minted token (typically the AERIS service wallet). */
  contributorAddress: string;
  /** Unix seconds when phone verification + operator review both completed. */
  verifiedAtUnix: number;
  /** Position rounded to ~111m (lib/onchain/commitments.ts#coarsenPosition). */
  coarsePosition: [number, number];
  /** sha256(exact lng|exact lat|salt) - proves the exact position without revealing it. */
  geoCommitment: string;
  /** sha256(description|salt) - proves the free-text report without revealing it. */
  descriptionCommitment: string;
  /** sha256(sha256(photo bytes)|salt), when the report has an approved evidence photo. */
  photoCommitment?: string;
  /** Optional override for the badge image URI. Never the raw evidence photo. */
  imageUri?: string;
  /** Optional override for the canonical report URL. */
  externalUrl?: string;
};

const DEFAULT_BADGE_IMAGE = "https://aeris.bagyo.app/badge/report.png";
const DEFAULT_EXTERNAL_BASE = "https://aeris.bagyo.app/reports";

function unixSeconds(date: string | undefined): number {
  if (!date) return Math.floor(Date.now() / 1000);
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return Math.floor(Date.now() / 1000);
  return Math.floor(t / 1000);
}

function clampStr(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}

export function buildAerisReportHypercert(
  input: BuildHypercertInput,
): AerisReportHypercert {
  const {
    report,
    contributorAddress,
    verifiedAtUnix,
    coarsePosition,
    geoCommitment,
    descriptionCommitment,
    photoCommitment,
    imageUri,
    externalUrl,
  } = input;

  const createdUnix = unixSeconds(report.createdAt);
  const verifiedUnix = verifiedAtUnix > 0 ? verifiedAtUnix : Math.floor(Date.now() / 1000);
  const [coarseLng, coarseLat] = coarsePosition;
  const name = `AERIS Report ${report.messageId ?? report.id.slice(0, 8)}`;
  // Generic, non-identifying summary - the citizen's free-text description is
  // never minted; only its commitment hash is (see description_commitment).
  const description = clampStr(
    `Verified ${report.category} report submitted via AERIS citizen reporting.`,
    280,
  );

  return {
    name,
    description,
    image: imageUri ?? DEFAULT_BADGE_IMAGE,
    external_url: externalUrl ?? `${DEFAULT_EXTERNAL_BASE}/${report.id}`,
    hypercert: {
      impact_scope: {
        name: "Disaster Response",
        value: [report.category],
      },
      work_scope: {
        name: "Incident Reporting",
        value: ["Citizen Report"],
      },
      work_timeframe: {
        name: "work_timeframe",
        value: [createdUnix, verifiedUnix],
      },
      impact_timeframe: {
        name: "impact_timeframe",
        value: [createdUnix, verifiedUnix],
      },
      contributors: {
        name: "contributors",
        value: [contributorAddress],
      },
      rights: {
        name: "rights",
        value: ["Public Display"],
      },
    },
    properties: [
      { trait_type: "report_id", value: report.id },
      { trait_type: "message_id", value: report.messageId ?? "" },
      { trait_type: "category", value: report.category },
      {
        trait_type: "ai_priority",
        value: report.aiPriority ?? "pending",
      },
      // Coarse position only (~111m) - full precision never leaves Supabase.
      { trait_type: "coarse_lat", value: coarseLat },
      { trait_type: "coarse_lng", value: coarseLng },
      { trait_type: "geo_commitment", value: geoCommitment },
      { trait_type: "description_commitment", value: descriptionCommitment },
      ...(photoCommitment
        ? [{ trait_type: "photo_commitment", value: photoCommitment }]
        : []),
      { trait_type: "dedupe_hash", value: report.dedupeHash ?? "" },
      {
        trait_type: "verified_at",
        value: new Date(verifiedUnix * 1000).toISOString(),
      },
      {
        trait_type: "phone_verification_status",
        value: report.phoneVerificationStatus ?? "unverified",
      },
      {
        trait_type: "verification_status",
        value: report.verificationStatus ?? "unverified",
      },
    ],
    schema: AERIS_REPORT_HYPERCERT_VERSION,
  };
}

/**
 * Derive a deterministic ERC-1155 tokenId (uint256 as decimal string) from
 * the report UUID so retries do not produce duplicate tokens.
 */
export function reportToTokenId(reportId: string): string {
  const hex = reportId.replace(/-/g, "");
  // 32 hex chars -> 128 bits, safely fits in uint256.
  return BigInt(`0x${hex}`).toString(10);
}
