/**
 * Shared Minds email dispatch.
 *
 * Storm-watch and AERIS report emails had byte-identical dispatch and task
 * formatting, differing only in the task header line and the log prefix. Both
 * now route through here so retry/reporting behaviour can only be changed in
 * one place.
 *
 * NOTE: delivery is performed by asking a Minds agent to send the mail — there
 * is no SMTP/API transport behind this. `sent: true` means the agent accepted
 * the instruction, NOT that mail was delivered. Replacing this with a real
 * provider is tracked separately.
 */

import {
  describeMindsApiError,
  mindsClientAvailable,
  sendWatchMessage,
} from "@/lib/minds-client";
import { isMindsNotifyEnabled } from "@/lib/minds-config";

/** Header line of the agent instruction; kept verbatim per email kind. */
export type MindsEmailKind = "STORM" | "REPORT";

export function formatMindsEmailTask(input: {
  kind: MindsEmailKind;
  recipients: string[];
  subject: string;
  body: string;
}): string {
  return [
    `AERIS ${input.kind} EMAIL TASK`,
    "Send one email per recipient below. Do not reply in chat — email only.",
    "",
    `Recipients: ${input.recipients.join(", ")}`,
    `Subject: ${input.subject}`,
    "",
    "Body:",
    input.body,
  ].join("\n");
}

export type MindsEmailDispatchResult = { sent: boolean; fingerprint?: string };

export async function dispatchEmailViaMinds(input: {
  kind: MindsEmailKind;
  /** Log tag, e.g. "storm-watch" or "aeris-reports". */
  logScope: string;
  recipients: string[];
  subject: string;
  body: string;
}): Promise<MindsEmailDispatchResult> {
  if (!isMindsNotifyEnabled() || !mindsClientAvailable()) {
    console.warn(`[${input.logScope}] Minds not configured; skipping email dispatch.`);
    return { sent: false };
  }

  if (input.recipients.length === 0) return { sent: false };

  const messageText = formatMindsEmailTask({
    kind: input.kind,
    recipients: input.recipients,
    subject: input.subject,
    body: input.body,
  });

  try {
    const { fingerprint } = await sendWatchMessage({ messageText });
    return { sent: true, fingerprint };
  } catch (error) {
    console.error(
      `[${input.logScope}] Minds dispatch failed: ${describeMindsApiError(error)}`,
    );
    return { sent: false };
  }
}
