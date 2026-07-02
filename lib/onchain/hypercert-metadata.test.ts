/** @jest-environment node */

import {
  AERIS_REPORT_HYPERCERT_VERSION,
  buildAerisReportHypercert,
  reportToTokenId,
} from "./hypercert-metadata";
import type { PublicReport } from "@/lib/supabase-reports";

function makeReport(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    messageId: "AERIS-20260527-ABCD1234",
    category: "flood",
    description:
      "Citizen-reported flooding in Marikina near Nangka bridge with rapid water rise.",
    position: [121.1063, 14.6433],
    createdAt: "2026-05-27T01:00:00.000Z",
    confirmations: 0,
    verificationStatus: "verified",
    phoneVerificationStatus: "verified",
    aiPriority: "urgent",
    dedupeHash: "abcd".repeat(16),
    reviewedAt: "2026-05-27T01:30:00.000Z",
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

const BASE_INPUT = {
  contributorAddress: "0x1111111111111111111111111111111111111111",
  verifiedAtUnix: 1779843600,
  coarsePosition: [121.106, 14.643] as [number, number],
  geoCommitment: "geo".padEnd(64, "0"),
  descriptionCommitment: "desc".padEnd(64, "0"),
};

describe("buildAerisReportHypercert", () => {
  it("emits the Hypercerts-shaped envelope with all dimensions", () => {
    const report = makeReport();
    const md = buildAerisReportHypercert({
      report,
      ...BASE_INPUT,
    });

    expect(md.schema).toBe(AERIS_REPORT_HYPERCERT_VERSION);
    expect(md.name).toContain("AERIS Report");
    expect(md.hypercert.impact_scope.value).toEqual(["flood"]);
    expect(md.hypercert.work_scope.name).toBe("Incident Reporting");
    expect(md.hypercert.work_scope.value).toEqual(["Citizen Report"]);
    expect(md.hypercert.contributors.value).toEqual([
      "0x1111111111111111111111111111111111111111",
    ]);
    expect(md.hypercert.work_timeframe.value[0]).toBeLessThanOrEqual(
      md.hypercert.work_timeframe.value[1],
    );
  });

  it("never includes the citizen's free-text description", () => {
    const md = buildAerisReportHypercert({
      report: makeReport({
        description: "Flooding right outside my house at 123 Rizal St, next to Maria's sari-sari store",
      }),
      ...BASE_INPUT,
    });
    expect(md.description).not.toContain("Rizal St");
    expect(md.description).not.toContain("Maria");
    expect(md.description.length).toBeLessThanOrEqual(280);
  });

  it("includes core traits and privacy commitments, but never exact lat/lng", () => {
    const md = buildAerisReportHypercert({
      report: makeReport(),
      ...BASE_INPUT,
      photoCommitment: "photo".padEnd(64, "0"),
    });
    const traits = md.properties.map((p) => p.trait_type);
    expect(traits).toEqual(
      expect.arrayContaining([
        "report_id",
        "message_id",
        "category",
        "ai_priority",
        "coarse_lat",
        "coarse_lng",
        "geo_commitment",
        "description_commitment",
        "photo_commitment",
        "dedupe_hash",
        "verified_at",
        "phone_verification_status",
        "verification_status",
      ]),
    );
    expect(traits).not.toContain("lat");
    expect(traits).not.toContain("lng");
  });

  it("omits photo_commitment when there is no evidence photo", () => {
    const md = buildAerisReportHypercert({
      report: makeReport(),
      ...BASE_INPUT,
    });
    const traits = md.properties.map((p) => p.trait_type);
    expect(traits).not.toContain("photo_commitment");
  });
});

describe("reportToTokenId", () => {
  it("derives a deterministic uint256 from the report uuid", () => {
    expect(reportToTokenId("00000000-0000-0000-0000-000000000001")).toBe("1");
    expect(reportToTokenId("00000000-0000-0000-0000-0000000000ff")).toBe("255");
  });

  it("is stable across runs", () => {
    const a = reportToTokenId("12345678-90ab-cdef-1234-567890abcdef");
    const b = reportToTokenId("12345678-90ab-cdef-1234-567890abcdef");
    expect(a).toBe(b);
  });
});
