import type { PagasaBulletin } from "@/lib/pagasa-bulletins";

export type StormEmailEventType = "entered_par" | "bulletin_update" | "final";

export type StormBulletinEvent = {
  cycloneSlug: string;
  cycloneName: string;
  bulletin: PagasaBulletin;
  eventType: StormEmailEventType;
  previousBulletinNumber: number | null;
};

export type StormWatchCycleRow = {
  cyclone_slug: string;
  cyclone_name: string;
  last_bulletin_number: number;
  last_bulletin_final: boolean;
  last_pdf_url: string | null;
  cycle_status: "active" | "completed";
  entered_par_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type StormWatchMetaRow = {
  id: number;
  last_polled_at: string | null;
  last_bulletin_signature: string | null;
  updated_at: string;
};

export type StormEmailRecipient = {
  userId: string;
  email: string;
  username: string;
};

export type StormWatchRunResult = {
  ok: boolean;
  skippedReason?: string;
  eventsDetected: number;
  emailsQueued: number;
  emailsSent: number;
  recipients: number;
  events: Array<{
    cycloneName: string;
    bulletinNumber: number;
    eventType: StormEmailEventType;
  }>;
  checkedAt: string;
};

export function cycloneSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function bulletinSignature(bulletins: PagasaBulletin[]): string {
  return bulletins
    .map((b) => `${cycloneSlug(b.name)}:${b.number}:${b.final ? "F" : "A"}`)
    .sort()
    .join("|");
}
