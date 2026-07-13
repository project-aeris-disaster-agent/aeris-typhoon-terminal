/**
 * Consolidated daily cron dispatcher.
 *
 * Vercel Hobby caps the *number* of cron jobs (excess crons silently never
 * fire), so all five jobs run from this single scheduled entry instead of five
 * separate `vercel.json` crons. The individual `app/api/cron/*` routes are kept
 * for manual/debug invocation; this route reuses the same underlying service
 * functions so there is one implementation per job.
 *
 * Jobs run sequentially in priority order and each is isolated in its own
 * try/catch, so one failure never aborts the rest. Time-sensitive public-alert
 * jobs (storm-watch, weather-reports) run first: if the function is killed at
 * the platform duration cap, the critical work has already completed and the
 * remaining sweeps are idempotent — the next day's run catches up.
 */

import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { runStormWatchCycle } from "@/services/storm-watch-runner";
import {
  runNationalWeatherReportCycle,
  type WeatherReportRunResult,
} from "@/services/weather-report-runner";
import { runAerisReportEmailCycle } from "@/services/aeris-report-email-runner";
import { triagePendingBatchDetailed } from "@/services/triage-runner";
import { mintStaleQueuedReports } from "@/services/onchain-mint-worker";
import { refreshMonitoredYoutubeChannels } from "@/lib/youtube-feed/serve";
import {
  notifyWatchOfficerDetailed,
  type TriageDigestItem,
} from "@/lib/minds-watch-officer";
import { getCognitionStatus, mindsClientAvailable } from "@/lib/minds-client";
import { isMindsNotifyEnabled } from "@/lib/minds-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const triageSecret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  if (triageSecret && auth === `Bearer ${triageSecret}`) return true;
  return false;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

type JobOutcome = {
  job: string;
  ok: boolean;
  elapsedMs: number;
  result?: unknown;
  error?: string;
};

async function runJob(
  job: string,
  fn: () => Promise<unknown>,
): Promise<JobOutcome> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return { job, ok: true, elapsedMs: Date.now() - startedAt, result };
  } catch (error) {
    console.error(`[cron-daily] ${job} failed: ${(error as Error).message}`);
    return {
      job,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: (error as Error).message,
    };
  }
}

/** Mirrors cron/triage: batch triage + Minds urgent digest. */
async function runTriageJob(deadlineAt: number) {
  const limit = parsePositiveInt(process.env.TRIAGE_CRON_BATCH_SIZE, 5);
  const safetyMarginMs = parsePositiveInt(process.env.TRIAGE_CRON_SAFETY_MS, 1500);
  const summary = await triagePendingBatchDetailed({
    limit,
    deadlineAt,
    safetyMarginMs,
  });

  const items: TriageDigestItem[] = summary.results
    .filter((row) => row.triaged && row.result)
    .map((row) => ({
      reportId: row.reportId,
      category: row.category ?? "unknown",
      description: row.description ?? "",
      priority: row.result!.priority,
      rationale: row.result!.rationale,
      confidence: row.result!.confidence,
    }));

  const minds = await notifyWatchOfficerDetailed(
    { kind: "triage_batch", items },
    { replyTimeoutMs: Math.max(0, deadlineAt - Date.now()) },
  ).catch(() => ({ notified: false, critical: false, confirmed: null }));

  return {
    processed: summary.results.length,
    triaged: summary.results.filter((r) => r.triaged).length,
    urgent: summary.results.filter((r) => r.result?.priority === "urgent")
      .length,
    remaining: summary.remaining,
    stoppedEarly: summary.stoppedEarly,
    mindsNotified: minds.notified,
    mindsConfirmed: minds.confirmed,
  };
}

/**
 * Best-effort cognition balance check so a drained Mind is visible in cron
 * logs before notifications silently stop. Never fails the cron.
 */
async function runMindsBalanceJob() {
  if (!isMindsNotifyEnabled() || !mindsClientAvailable()) {
    return { skipped: true };
  }
  const status = await getCognitionStatus();
  if (status.low) {
    console.warn(
      `[cron-daily] Minds cognition balance low: ${status.balance.cognition} < ${status.warnThreshold}`,
    );
  }
  return {
    balance: status.balance.cognition,
    warnThreshold: status.warnThreshold,
    low: status.low,
  };
}

/** Mirrors cron/onchain-mint: sweep stale queued rows. */
async function runOnchainMintJob(deadlineAt: number) {
  const limit = parsePositiveInt(process.env.ONCHAIN_MINT_BATCH_LIMIT, 10);
  const rawMinAge = Number(process.env.ONCHAIN_MINT_STALE_SECONDS ?? "120");
  const minAgeSeconds =
    Number.isFinite(rawMinAge) && rawMinAge >= 0 ? rawMinAge : 120;
  return mintStaleQueuedReports({
    limit,
    deadlineAt,
    safetyMarginMs: 7_000,
    minAgeSeconds,
  });
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const startedAt = Date.now();
  // Reserve a safety margin under the platform duration cap so the response
  // still flushes even if the last job runs long.
  const globalDeadline = startedAt + maxDuration * 1000 - 5_000;

  const jobs: JobOutcome[] = [];
  jobs.push(
    await runJob("storm-watch", () => runStormWatchCycle({ force: false })),
  );
  const weatherOutcome = await runJob("weather-reports", () =>
    runNationalWeatherReportCycle(),
  );
  jobs.push(weatherOutcome);
  jobs.push(
    await runJob("report-emails", () => {
      const weather = weatherOutcome.ok
        ? (weatherOutcome.result as WeatherReportRunResult)
        : null;
      if (
        !weather?.generated ||
        !weather.reportId ||
        !weather.reportType ||
        !weather.composed ||
        !weather.snapshot
      ) {
        return Promise.resolve({ skipped: true, reason: "no_new_report" });
      }
      return runAerisReportEmailCycle({
        reportId: weather.reportId,
        reportType: weather.reportType,
        composed: weather.composed,
        snapshot: weather.snapshot,
        narrativeTimeoutMs: Math.max(0, globalDeadline - Date.now() - 15_000),
      });
    }),
  );
  jobs.push(
    await runJob("triage", () =>
      runTriageJob(Math.min(globalDeadline, Date.now() + 10_000)),
    ),
  );
  jobs.push(
    await runJob("onchain-mint", () => runOnchainMintJob(globalDeadline)),
  );
  jobs.push(
    await runJob("youtube-feed", () => refreshMonitoredYoutubeChannels()),
  );
  jobs.push(await runJob("minds-balance", () => runMindsBalanceJob()));

  return jsonOkNoStore({
    ok: jobs.every((j) => j.ok),
    elapsedMs: Date.now() - startedAt,
    jobs,
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  return GET(request);
}
