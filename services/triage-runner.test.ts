/** @jest-environment node */

import type { PublicReport } from "@/lib/supabase-reports";
import type { TriageResult } from "@/services/ai-triage";

jest.mock("@/lib/supabase-reports", () => {
  const actual = jest.requireActual("@/lib/supabase-reports");
  return {
    ...actual,
    listPendingTriageReports: jest.fn(),
    findDuplicateReport: jest.fn(),
    patchAiTriageFields: jest.fn(),
    reviewSupabaseReport: jest.fn(),
    getSupabaseReportById: jest.fn(),
  };
});

jest.mock("@/lib/supabase-agent", () => ({
  insertUrgentReportAgentMessage: jest.fn(),
}));

jest.mock("@/services/ai-triage", () => {
  const actual = jest.requireActual("@/services/ai-triage");
  return {
    ...actual,
    classifyReport: jest.fn(),
  };
});

import { formatUrgentBroadcast, triagePendingBatchDetailed } from "@/services/triage-runner";
import * as supabaseReports from "@/lib/supabase-reports";
import * as aiTriage from "@/services/ai-triage";

const baseReport: PublicReport = {
  id: "report-1",
  messageId: "AERIS-20260527-ABCD1234",
  category: "SOS",
  description: "Family trapped on roof, water rising",
  position: [121.0244, 14.5547],
  createdAt: "2026-05-27T01:00:00.000Z",
  confirmations: 0,
  verificationStatus: "unverified",
  moderationStatus: "visible",
};

const baseResult: TriageResult = {
  priority: "urgent",
  rationale: "Life-safety keywords detected: trapped, rising water.",
  confidence: 0.82,
  isSpam: false,
  isDuplicate: false,
  dedupeHash: "a".repeat(64),
};

describe("triage-runner urgent broadcast", () => {
  it("includes category, coordinates, confidence and rationale", () => {
    const out = formatUrgentBroadcast(baseReport, baseResult);
    expect(out).toContain("URGENT INCIDENT");
    expect(out).toContain("[AERIS-20260527-ABCD1234]");
    expect(out).toContain("Category: SOS");
    expect(out).toContain("14.5547, 121.0244");
    expect(out).toContain("Confidence: 82%");
    expect(out).toContain(baseResult.rationale);
    expect(out).toContain("trapped");
  });

  it("truncates long descriptions to 280 characters with ellipsis", () => {
    const long = "x".repeat(500);
    const out = formatUrgentBroadcast({ ...baseReport, description: long }, baseResult);
    const reportLine = out.split("\n").find((line) => line.startsWith("Report: "))!;
    expect(reportLine.length).toBeLessThanOrEqual("Report: ".length + 280);
    expect(reportLine.endsWith("...")).toBe(true);
  });
});

describe("triagePendingBatchDetailed deadline handling", () => {
  const mockedList = supabaseReports.listPendingTriageReports as jest.MockedFunction<
    typeof supabaseReports.listPendingTriageReports
  >;
  const mockedDup = supabaseReports.findDuplicateReport as jest.MockedFunction<
    typeof supabaseReports.findDuplicateReport
  >;
  const mockedPatch = supabaseReports.patchAiTriageFields as jest.MockedFunction<
    typeof supabaseReports.patchAiTriageFields
  >;
  const mockedReview = supabaseReports.reviewSupabaseReport as jest.MockedFunction<
    typeof supabaseReports.reviewSupabaseReport
  >;
  const mockedClassify = aiTriage.classifyReport as jest.MockedFunction<
    typeof aiTriage.classifyReport
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDup.mockResolvedValue(null);
    mockedPatch.mockResolvedValue(undefined);
    mockedReview.mockResolvedValue({} as unknown as PublicReport);
  });

  function makeReport(id: string): PublicReport {
    return {
      ...baseReport,
      id,
      messageId: `AERIS-X-${id}`,
      description: `report ${id} description with some words to look real`,
      // Pre-set dedupeHash so applyTriage calls classifyReport exactly once
      // per report (otherwise it calls twice: once to compute hash, once to classify).
      dedupeHash: `h${id}${"0".repeat(63 - id.length)}`,
    };
  }

  it("stops fetching the next report once within safety margin of deadline", async () => {
    const reports = [makeReport("a"), makeReport("b"), makeReport("c")];
    mockedList.mockResolvedValue(reports);

    let calls = 0;
    mockedClassify.mockImplementation(async () => {
      calls += 1;
      // Each classify burns enough wall-clock that after the 1st we should bail.
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        priority: "low_priority",
        rationale: "ok",
        confidence: 0.6,
        isSpam: false,
        isDuplicate: false,
        dedupeHash: "f".repeat(64),
      } satisfies TriageResult;
    });

    const summary = await triagePendingBatchDetailed({
      limit: 3,
      deadlineAt: Date.now() + 100,
      safetyMarginMs: 40,
    });

    expect(summary.stoppedEarly).toBe(true);
    expect(summary.results.length).toBeLessThan(reports.length);
    expect(summary.remaining).toBe(reports.length - summary.results.length);
    expect(calls).toBe(summary.results.length);
  });

  it("processes the full batch when no deadline pressure", async () => {
    const reports = [makeReport("a"), makeReport("b")];
    mockedList.mockResolvedValue(reports);
    mockedClassify.mockResolvedValue({
      priority: "low_priority",
      rationale: "ok",
      confidence: 0.6,
      isSpam: false,
      isDuplicate: false,
      dedupeHash: "0".repeat(64),
    });

    const summary = await triagePendingBatchDetailed({
      limit: 2,
      deadlineAt: Date.now() + 5_000,
      safetyMarginMs: 100,
    });

    expect(summary.stoppedEarly).toBe(false);
    expect(summary.results).toHaveLength(2);
    expect(summary.remaining).toBe(0);
    expect(mockedPatch).toHaveBeenCalledTimes(2);
  });
});
