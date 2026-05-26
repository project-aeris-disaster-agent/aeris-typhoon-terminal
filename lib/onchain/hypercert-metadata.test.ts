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

describe("buildAerisReportHypercert", () => {
  it("emits the Hypercerts-shaped envelope with all dimensions", () => {
    const report = makeReport();
    const md = buildAerisReportHypercert({
      report,
      contributorAddress: "0x1111111111111111111111111111111111111111",
      verifiedAtUnix: 1779843600,
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

  it("clamps long descriptions to <=280 chars", () => {
    const long = "x".repeat(600);
    const md = buildAerisReportHypercert({
      report: makeReport({ description: long }),
      contributorAddress: "0xabc",
      verifiedAtUnix: Math.floor(Date.now() / 1000),
    });
    expect(md.description.length).toBeLessThanOrEqual(280);
  });

  it("includes core traits", () => {
    const md = buildAerisReportHypercert({
      report: makeReport(),
      contributorAddress: "0xabc",
      verifiedAtUnix: 1779843600,
    });
    const traits = md.properties.map((p) => p.trait_type);
    expect(traits).toEqual(
      expect.arrayContaining([
        "report_id",
        "message_id",
        "category",
        "ai_priority",
        "lat",
        "lng",
        "dedupe_hash",
        "verified_at",
        "phone_verification_status",
        "verification_status",
      ]),
    );
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
