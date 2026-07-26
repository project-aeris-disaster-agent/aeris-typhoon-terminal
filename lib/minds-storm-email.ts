import { dispatchEmailViaMinds } from "@/lib/minds-email-dispatch";
import { stormEmailBody, stormEmailSubject } from "@/lib/storm-watch/email-templates";
import type { StormBulletinEvent, StormEmailRecipient } from "@/lib/storm-watch/types";

/** Renders a storm bulletin into subject/body and hands it to the shared dispatcher. */
export async function dispatchStormEmailViaMinds(input: {
  event: StormBulletinEvent;
  recipients: StormEmailRecipient[];
  issuedAt: string;
}): Promise<{ sent: boolean; fingerprint?: string }> {
  return dispatchEmailViaMinds({
    kind: "STORM",
    logScope: "storm-watch",
    recipients: input.recipients.map((r) => r.email),
    subject: stormEmailSubject(
      input.event.cycloneName,
      input.event.bulletin,
      input.event.eventType,
    ),
    body: stormEmailBody({
      cycloneName: input.event.cycloneName,
      bulletin: input.event.bulletin,
      eventType: input.event.eventType,
      issuedAt: input.issuedAt,
      previousBulletinNumber: input.event.previousBulletinNumber,
    }),
  });
}
