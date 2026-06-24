import type { PagasaBulletin, PagasaBulletins } from "@/lib/pagasa-bulletins";
import {
  cycloneSlug,
  type StormBulletinEvent,
  type StormEmailEventType,
  type StormWatchCycleRow,
} from "@/lib/storm-watch/types";

export function classifyBulletinEvent(
  bulletin: PagasaBulletin,
  previous: StormWatchCycleRow | null,
): StormEmailEventType | null {
  const prevNumber = previous?.last_bulletin_number ?? 0;

  if (bulletin.final) {
    if (prevNumber >= bulletin.number && previous?.last_bulletin_final) {
      return null;
    }
    return "final";
  }

  if (!previous || prevNumber === 0) {
    return bulletin.number <= 1 ? "entered_par" : "entered_par";
  }

  if (bulletin.number <= prevNumber) {
    return null;
  }

  return "bulletin_update";
}

export function diffPagasaBulletinEvents(
  payload: PagasaBulletins | null,
  cyclesBySlug: Map<string, StormWatchCycleRow>,
): StormBulletinEvent[] {
  if (!payload) return [];

  const bulletinsToCheck = payload.bulletins.filter((bulletin) => {
    if (!bulletin.final) return true;
    const previous = cyclesBySlug.get(cycloneSlug(bulletin.name));
    return previous?.cycle_status === "active";
  });

  const events: StormBulletinEvent[] = [];

  for (const bulletin of bulletinsToCheck) {
    const slug = cycloneSlug(bulletin.name);
    const previous = cyclesBySlug.get(slug) ?? null;
    const eventType = classifyBulletinEvent(bulletin, previous);
    if (!eventType) continue;

    events.push({
      cycloneSlug: slug,
      cycloneName: bulletin.name,
      bulletin,
      eventType,
      previousBulletinNumber: previous?.last_bulletin_number ?? null,
    });
  }

  return events.sort((a, b) => {
    if (a.eventType === "entered_par" && b.eventType !== "entered_par") return -1;
    if (b.eventType === "entered_par" && a.eventType !== "entered_par") return 1;
    return a.cycloneName.localeCompare(b.cycloneName);
  });
}

export function cycleRowAfterEvent(
  event: StormBulletinEvent,
  existing: StormWatchCycleRow | null,
): StormWatchCycleRow {
  const now = new Date().toISOString();
  const isFinal = event.bulletin.final || event.eventType === "final";

  return {
    cyclone_slug: event.cycloneSlug,
    cyclone_name: event.cycloneName,
    last_bulletin_number: event.bulletin.number,
    last_bulletin_final: isFinal,
    last_pdf_url: event.bulletin.pdfUrl,
    cycle_status: isFinal ? "completed" : "active",
    entered_par_at:
      event.eventType === "entered_par"
        ? now
        : existing?.entered_par_at ?? now,
    completed_at: isFinal ? now : null,
    updated_at: now,
  };
}
