/**
 * AERIS Reports email cycle: after a national weather brief is generated,
 * email it to opted-in active users via the Minds Watch Officer. One Minds
 * email task per report (all recipients batched), deduped per user per
 * report so cron retries never double-send.
 */

import {
  aerisReportEmailBody,
  aerisReportEmailSubject,
  dispatchAerisReportEmailViaMinds,
  listAerisReportRecipients,
  listReportEmailedUserIds,
  logReportEmailSent,
} from "@/lib/aeris-report-email";
import { composeMindReportNarrative } from "@/lib/minds-report-author";
import type { ComposedWeatherReport } from "@/services/weather-report-compose";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";

export type AerisReportEmailRunResult = {
  skipped: boolean;
  reason?: string;
  recipients: number;
  emailsQueued: number;
  narrativeIncluded: boolean;
};

export async function runAerisReportEmailCycle(input: {
  reportId: string;
  reportType: WeatherReportType;
  composed: ComposedWeatherReport;
  snapshot: NationalWeatherSnapshot;
  /** Bound on the optional Mind narrative wait, from the caller's budget. */
  narrativeTimeoutMs?: number;
}): Promise<AerisReportEmailRunResult> {
  const allRecipients = await listAerisReportRecipients();
  if (allRecipients.length === 0) {
    return {
      skipped: true,
      reason: "no_recipients",
      recipients: 0,
      emailsQueued: 0,
      narrativeIncluded: false,
    };
  }

  const alreadyEmailed = await listReportEmailedUserIds(input.reportId);
  const recipients = allRecipients.filter(
    (recipient) => !alreadyEmailed.has(recipient.userId),
  );
  if (recipients.length === 0) {
    return {
      skipped: true,
      reason: "already_sent",
      recipients: allRecipients.length,
      emailsQueued: 0,
      narrativeIncluded: false,
    };
  }

  // Optional Mind-authored assessment; null on timeout/disabled — the email
  // still ships with deterministic content only.
  const mindNarrative = await composeMindReportNarrative({
    reportType: input.reportType,
    composed: input.composed,
    snapshot: input.snapshot,
    ...(input.narrativeTimeoutMs !== undefined
      ? { timeoutMs: input.narrativeTimeoutMs }
      : {}),
  });

  const subject = aerisReportEmailSubject(input.reportType, input.snapshot);
  const body = aerisReportEmailBody({
    reportType: input.reportType,
    composed: input.composed,
    snapshot: input.snapshot,
    reportId: input.reportId,
    mindNarrative,
  });

  const dispatch = await dispatchAerisReportEmailViaMinds({
    recipients,
    subject,
    body,
  });
  if (!dispatch.sent) {
    return {
      skipped: true,
      reason: "dispatch_failed",
      recipients: recipients.length,
      emailsQueued: 0,
      narrativeIncluded: Boolean(mindNarrative),
    };
  }

  for (const recipient of recipients) {
    await logReportEmailSent({
      reportId: input.reportId,
      reportType: input.reportType,
      userId: recipient.userId,
      recipientEmail: recipient.email,
      mindsFingerprint: dispatch.fingerprint,
    });
  }

  return {
    skipped: false,
    recipients: recipients.length,
    emailsQueued: recipients.length,
    narrativeIncluded: Boolean(mindNarrative),
  };
}
