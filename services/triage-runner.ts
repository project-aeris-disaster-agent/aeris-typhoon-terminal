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
import { insertUrgentReportAgentMessage } from "@/lib/supabase-agent";

export type TriageRunResult = {
  reportId: string;
  triaged: boolean;
  result?: TriageResult;
  autoRejected?: boolean;
  broadcasted?: boolean;
  error?: string;
};

export type TriageBatchOptions = {
  /** Hard cap on number of reports to process in this invocation. */
  limit?: number;
  /**
   * Wall-clock deadline in ms (e.g. `Date.now() + 8000`). When set, the
   * runner stops fetching the next report once we are within
   * `safetyMarginMs` of the deadline so the function returns cleanly
   * inside platform timeouts (Vercel Hobby = ~10s).
   */
  deadlineAt?: number;
  /** Safety margin before deadlineAt to bail out (default 1500 ms). */
  safetyMarginMs?: number;
};

export type TriageBatchSummary = {
  results: TriageRunResult[];
  /** True when we stopped early due to deadline; false when batch fully drained. */
  stoppedEarly: boolean;
  /** Remaining reports we did not get to (queue length at stop time, when known). */
  remaining: number;
};

export function formatUrgentBroadcast(report: PublicReport, result: TriageResult): string {
  const [lng, lat] = report.position;
  const coords =
    typeof lat === "number" && typeof lng === "number"
      ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      : "unknown coordinates";
  const messageId = report.messageId ? ` [${report.messageId}]` : "";
  const confidencePct = Math.round(result.confidence * 100);
  const description = report.description.length > 280
    ? `${report.description.slice(0, 277).trim()}...`
    : report.description;
  return [
    `URGENT INCIDENT triaged by AGENT AERIS${messageId}`,
    `Category: ${report.category}`,
    `Location: ${coords}`,
    `Confidence: ${confidencePct}%`,
    `Rationale: ${result.rationale}`,
    `Report: ${description}`,
  ].join("\n");
}

export async function triageOneReport(reportId: string): Promise<TriageRunResult> {
  const report = await getSupabaseReportById(reportId);
  if (!report) {
    return { reportId, triaged: false, error: "Report not found." };
  }
  return applyTriage(report);
}

export async function triagePendingBatch(
  limitOrOptions: number | TriageBatchOptions = 25,
): Promise<TriageRunResult[]> {
  const summary = await triagePendingBatchDetailed(limitOrOptions);
  return summary.results;
}

export async function triagePendingBatchDetailed(
  limitOrOptions: number | TriageBatchOptions = 25,
): Promise<TriageBatchSummary> {
  const options: TriageBatchOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const safetyMarginMs = Math.max(0, options.safetyMarginMs ?? 1500);
  const deadlineAt = options.deadlineAt;

  const pending = await listPendingTriageReports(limit);
  const results: TriageRunResult[] = [];

  let stoppedEarly = false;
  let processed = 0;

  for (const report of pending) {
    if (
      typeof deadlineAt === "number" &&
      Date.now() + safetyMarginMs >= deadlineAt
    ) {
      stoppedEarly = true;
      break;
    }
    results.push(await applyTriage(report));
    processed += 1;
  }

  return {
    results,
    stoppedEarly,
    remaining: Math.max(0, pending.length - processed),
  };
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

    let broadcasted = false;
    if (result.priority === "urgent") {
      const inserted = await insertUrgentReportAgentMessage(
        formatUrgentBroadcast(report, result),
        {
          disasterReportId: report.id,
          sessionId: report.sessionId,
        },
      );
      broadcasted = Boolean(inserted);
    }

    return {
      reportId: report.id,
      triaged: true,
      result,
      autoRejected,
      broadcasted,
    };
  } catch (error) {
    const message = (error as Error).message;
    // Surface to stderr for Vercel function logs / log-based alerting; the
    // returned `error` field is what the cron summary reports back to callers.
    console.error(`[triage] report=${report.id} failed: ${message}`);
    return {
      reportId: report.id,
      triaged: false,
      error: message,
    };
  }
}
