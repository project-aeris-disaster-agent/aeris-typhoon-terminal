import {
  describeMindsApiError,
  mindsClientAvailable,
  sendWatchMessage,
} from "@/lib/minds-client";
import { isMindsNotifyEnabled } from "@/lib/minds-config";
import {
  formatMindsStormEmailTask,
  stormEmailBody,
  stormEmailSubject,
} from "@/lib/storm-watch/email-templates";
import type { StormBulletinEvent, StormEmailRecipient } from "@/lib/storm-watch/types";

export async function dispatchStormEmailViaMinds(input: {
  event: StormBulletinEvent;
  recipients: StormEmailRecipient[];
  issuedAt: string;
}): Promise<{ sent: boolean; fingerprint?: string }> {
  if (!isMindsNotifyEnabled() || !mindsClientAvailable()) {
    console.warn("[storm-watch] Minds not configured; skipping email dispatch.");
    return { sent: false };
  }

  if (input.recipients.length === 0) return { sent: false };

  const subject = stormEmailSubject(
    input.event.cycloneName,
    input.event.bulletin,
    input.event.eventType,
  );
  const body = stormEmailBody({
    cycloneName: input.event.cycloneName,
    bulletin: input.event.bulletin,
    eventType: input.event.eventType,
    issuedAt: input.issuedAt,
    previousBulletinNumber: input.event.previousBulletinNumber,
  });

  const messageText = formatMindsStormEmailTask({
    recipients: input.recipients.map((r) => r.email),
    subject,
    body,
  });

  try {
    const { fingerprint } = await sendWatchMessage({ messageText });
    return { sent: true, fingerprint };
  } catch (error) {
    console.error(
      `[storm-watch] Minds dispatch failed: ${describeMindsApiError(error)}`,
    );
    return { sent: false };
  }
}
