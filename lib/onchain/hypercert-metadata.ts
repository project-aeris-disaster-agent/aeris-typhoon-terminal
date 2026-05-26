/**
 * Phase 6.1 - Hypercerts-shaped ERC-1155 token metadata for AERIS reports.
 *
 * This is intentionally "Hypercerts-shaped, not protocol-compliant". We reuse
 * the dimension names defined by the Hypercerts data model
 * (impact_scope, work_scope, work_timeframe, impact_timeframe,
 * contributors, rights) so a future migration to AT-Protocol-native
 * Hypercerts is straightforward, but we do not interact with the
 * Hypercerts contracts or PDS at this layer.
 *
 * https://docs.hypercerts.org/
 */

import type { PublicReport } from "@/lib/supabase-reports";

export const AERIS_REPORT_HYPERCERT_VERSION = "aeris.report.v1";

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
  /** Optional override for the badge image URI (ipfs://... or https://...). */
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
  const { report, contributorAddress, verifiedAtUnix, imageUri, externalUrl } = input;

  const createdUnix = unixSeconds(report.createdAt);
  const verifiedUnix = verifiedAtUnix > 0 ? verifiedAtUnix : Math.floor(Date.now() / 1000);
  const [lng, lat] = report.position;
  const name = `AERIS Report ${report.messageId ?? report.id.slice(0, 8)}`;
  const description = clampStr(report.description ?? "", 280);

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
      { trait_type: "lat", value: Number(lat.toFixed(6)) },
      { trait_type: "lng", value: Number(lng.toFixed(6)) },
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
