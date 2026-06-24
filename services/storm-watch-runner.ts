import { fetchPagasaBulletins } from "@/lib/pagasa-bulletins";
import { dispatchStormEmailViaMinds } from "@/lib/minds-storm-email";
import {
  cycleRowAfterEvent,
  diffPagasaBulletinEvents,
} from "@/lib/storm-watch/bulletin-events";
import { listStormEmailRecipients } from "@/lib/storm-watch/recipients";
import {
  getStormWatchMeta,
  hasStormEmailBeenSent,
  listStormWatchCycles,
  logStormEmailSent,
  patchStormWatchMeta,
  stormWatchStateEnabled,
  upsertStormWatchCycle,
} from "@/lib/storm-watch/state";
import {
  bulletinSignature,
  type StormWatchRunResult,
} from "@/lib/storm-watch/types";

function parseMinPollMs(): number {
  const raw = Number(process.env.STORM_WATCH_MIN_POLL_MS ?? "300000");
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 300_000;
}

export async function runStormWatchCycle(options?: {
  force?: boolean;
}): Promise<StormWatchRunResult> {
  const checkedAt = new Date().toISOString();

  if (!stormWatchStateEnabled()) {
    return {
      ok: false,
      skippedReason: "supabase_not_configured",
      eventsDetected: 0,
      emailsQueued: 0,
      emailsSent: 0,
      recipients: 0,
      events: [],
      checkedAt,
    };
  }

  const meta = await getStormWatchMeta();
  const minPollMs = parseMinPollMs();

  const payload = await fetchPagasaBulletins({ bypassCache: true });
  const signature = payload ? bulletinSignature(payload.bulletins) : "";

  if (
    !options?.force &&
    meta?.last_bulletin_signature === signature &&
    meta.last_polled_at &&
    Date.now() - new Date(meta.last_polled_at).getTime() < minPollMs
  ) {
    return {
      ok: true,
      skippedReason: "unchanged_within_poll_window",
      eventsDetected: 0,
      emailsQueued: 0,
      emailsSent: 0,
      recipients: 0,
      events: [],
      checkedAt,
    };
  }

  const cycles = await listStormWatchCycles();
  const cyclesBySlug = new Map(cycles.map((c) => [c.cyclone_slug, c]));
  const events = diffPagasaBulletinEvents(payload, cyclesBySlug);

  const recipients = await listStormEmailRecipients();

  let emailsQueued = 0;
  let emailsSent = 0;
  const eventSummaries: StormWatchRunResult["events"] = [];

  for (const event of events) {
    eventSummaries.push({
      cycloneName: event.cycloneName,
      bulletinNumber: event.bulletin.number,
      eventType: event.eventType,
    });

    const pending = [];
    for (const recipient of recipients) {
      const already = await hasStormEmailBeenSent(
        event.cycloneSlug,
        event.bulletin.number,
        recipient.userId,
      );
      if (!already) pending.push(recipient);
    }

    emailsQueued += pending.length;

    if (pending.length > 0) {
      const dispatch = await dispatchStormEmailViaMinds({
        event,
        recipients: pending,
        issuedAt: payload?.fetchedAt ?? checkedAt,
      });

      if (dispatch.sent) {
        for (const recipient of pending) {
          await logStormEmailSent({
            cycloneSlug: event.cycloneSlug,
            bulletinNumber: event.bulletin.number,
            eventType: event.eventType,
            userId: recipient.userId,
            recipientEmail: recipient.email,
            mindsFingerprint: dispatch.fingerprint,
          });
        }
        emailsSent += pending.length;
      }
    }

    await upsertStormWatchCycle(
      cycleRowAfterEvent(event, cyclesBySlug.get(event.cycloneSlug) ?? null),
    );
  }

  await patchStormWatchMeta({
    last_polled_at: checkedAt,
    last_bulletin_signature: signature,
  });

  return {
    ok: true,
    eventsDetected: events.length,
    emailsQueued,
    emailsSent,
    recipients: recipients.length,
    events: eventSummaries,
    checkedAt,
  };
}

let syncHookInFlight: Promise<StormWatchRunResult> | null = null;

/** Lightweight poll when an operator is active — respects min poll window. */
export async function maybeRunStormWatchOnSync(): Promise<StormWatchRunResult | null> {
  if (syncHookInFlight) return syncHookInFlight;

  syncHookInFlight = runStormWatchCycle().finally(() => {
    syncHookInFlight = null;
  });

  return syncHookInFlight;
}
