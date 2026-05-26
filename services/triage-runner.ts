import {
  classifyReport,
  toTriageInput,
  type TriageResult,
} from "@/services/ai-triage";
import {
  findDuplicateReport,
  getSupabaseReportById,
  listPendingTriageReports,
  patchAiTriageFields,
  reviewSupabaseReport,
  type PublicReport,
} from "@/lib/supabase-reports";

export type TriageRunResult = {
  reportId: string;
  triaged: boolean;
  result?: TriageResult;
  autoRejected?: boolean;
  error?: string;
};

export async function triageOneReport(reportId: string): Promise<TriageRunResult> {
  const report = await getSupabaseReportById(reportId);
  if (!report) {
    return { reportId, triaged: false, error: "Report not found." };
  }
  return applyTriage(report);
}

export async function triagePendingBatch(limit = 25): Promise<TriageRunResult[]> {
  const pending = await listPendingTriageReports(limit);
  const results: TriageRunResult[] = [];
  for (const report of pending) {
    results.push(await applyTriage(report));
  }
  return results;
}

async function applyTriage(report: PublicReport): Promise<TriageRunResult> {
  try {
    const input = toTriageInput(report);
    const dedupeHash =
      report.dedupeHash ??
      (
        await classifyReport(input)
      ).dedupeHash;

    const duplicate = await findDuplicateReport(dedupeHash, report.id);
    const result = await classifyReport(input, duplicate?.id);

    const triagedAt = new Date().toISOString();
    await patchAiTriageFields(report.id, {
      aiPriority: result.priority,
      aiTriageAt: triagedAt,
      aiTriageRationale: result.rationale,
      aiTriageConfidence: result.confidence,
      dedupeHash: result.dedupeHash,
    });

    let autoRejected = false;
    if (
      result.priority === "rejected" &&
      (result.isSpam || result.isDuplicate) &&
      result.confidence >= 0.75
    ) {
      await reviewSupabaseReport({
        reportId: report.id,
        action: result.isDuplicate ? "duplicate" : "reject",
        actorType: "ai_agent",
        actorId: "aeris-ai-triage",
        note: result.rationale,
        confidence: result.confidence,
        metadata: {
          aiPriority: result.priority,
          duplicateOfId: result.duplicateOfId ?? null,
        },
      });
      autoRejected = true;
    }

    return {
      reportId: report.id,
      triaged: true,
      result,
      autoRejected,
    };
  } catch (error) {
    return {
      reportId: report.id,
      triaged: false,
      error: (error as Error).message,
    };
  }
}
