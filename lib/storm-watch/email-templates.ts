import { formatPhTimestamp } from "@/lib/weather-risk";
import { getDashboardPublicUrl } from "@/lib/minds-config";
import type { PagasaBulletin } from "@/lib/pagasa-bulletins";
import type { StormEmailEventType } from "@/lib/storm-watch/types";

const DISCLAIMER =
  "Not an official PAGASA product. Follow PAGASA, NDRRMC, and your LGU for evacuation orders.";

function classifyLabel(number: number): string {
  if (number <= 1) return "Tropical Cyclone Bulletin";
  return "Tropical Cyclone Bulletin update";
}

export function stormEmailSubject(
  cycloneName: string,
  bulletin: PagasaBulletin,
  eventType: StormEmailEventType,
): string {
  if (eventType === "entered_par") {
    return `AERIS: ${cycloneName} — entered PAR (PAGASA Bulletin #${bulletin.number})`;
  }
  if (eventType === "final") {
    return `AERIS: ${cycloneName} — final PAGASA bulletin (#${bulletin.number})`;
  }
  return `AERIS: ${cycloneName} — PAGASA Bulletin #${bulletin.number}`;
}

export function stormEmailBody(input: {
  cycloneName: string;
  bulletin: PagasaBulletin;
  eventType: StormEmailEventType;
  issuedAt: string;
  previousBulletinNumber?: number | null;
}): string {
  const { cycloneName, bulletin, eventType, issuedAt, previousBulletinNumber } =
    input;
  const stamp = formatPhTimestamp(issuedAt);
  const dashboard = getDashboardPublicUrl();
  const pdfLink = bulletin.pdfUrl;

  const lines: string[] = [];

  if (eventType === "entered_par") {
    lines.push(
      `Tropical Cyclone ${cycloneName} is now within the Philippine Area of Responsibility (PAR).`,
      "",
      `PAGASA has issued ${classifyLabel(bulletin.number)} #${bulletin.number} for ${cycloneName}.`,
      "This begins your AERIS storm email cycle — you will receive updates as PAGASA publishes new bulletins while the system remains active in PAR.",
    );
  } else if (eventType === "final") {
    lines.push(
      `PAGASA has issued the final Tropical Cyclone Bulletin (#${bulletin.number}) for ${cycloneName}.`,
      "",
      "This closes the AERIS email cycle for this system unless PAGASA resumes bulletins.",
    );
  } else {
    lines.push(
      `UPDATE: ${cycloneName} — PAGASA Bulletin #${bulletin.number} has been issued.`,
      previousBulletinNumber
        ? `(Previous bulletin: #${previousBulletinNumber})`
        : "",
      "",
      "Conditions may have changed since the last bulletin. Review the official PDF and your AERIS dashboard for the latest track and hazard context.",
    );
  }

  lines.push(
    "",
    "OFFICIAL BULLETIN",
    `- PDF: ${pdfLink}`,
    `- File: ${bulletin.file}`,
    `- Issued (AERIS check): ${stamp} PHT`,
    "",
    "AERIS DASHBOARD",
    `- Live terminal: ${dashboard}`,
    "- Use the Typhoon Tracker and Alerts panels for track, PAR boundary, and hazard overlays.",
    "",
    DISCLAIMER,
  );

  return lines.filter((line) => line !== "").join("\n");
}

export function formatMindsStormEmailTask(input: {
  recipients: string[];
  subject: string;
  body: string;
}): string {
  const recipientBlock = input.recipients.join(", ");
  return [
    "AERIS STORM EMAIL TASK",
    "Send one email per recipient below. Do not reply in chat — email only.",
    "",
    `Recipients: ${recipientBlock}`,
    `Subject: ${input.subject}`,
    "",
    "Body:",
    input.body,
  ].join("\n");
}
