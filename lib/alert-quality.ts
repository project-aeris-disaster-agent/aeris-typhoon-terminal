export type AlertLike = {
  id: string;
  source: string;
  title: string;
  summary: string;
};

const NAV_ONLY =
  /^(tropical cyclone(?:\s+(?:advisory|bulletin|warning(?:\s+for\s+\w+)?))?|weather advisory|gale warning|severe weather bulletin)$/i;

const REQUIRES_SUBSTANCE =
  /signal\s*#?\s*\d|\d+\s*km\/h|\d+\s*kph|magnitude\s+\d|issued\s+(?:at|on)|hoisted|landfall|pressure\s+\d{3,4}/i;

export function isNavSlop(text: string): boolean {
  const n = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (n.includes("-->")) return true;
  if (NAV_ONLY.test(n)) return true;
  // Repeated phrase (title duplicated in body)
  const half = Math.floor(n.length / 2);
  if (half > 20 && n.slice(0, half) === n.slice(half, half * 2).trim()) return true;
  // Menu label repeated back-to-back
  if (/^(tropical cyclone warning for \w+\s+){2,}/i.test(n)) return true;
  return false;
}

export function isSubstantiveAlert(alert: AlertLike): boolean {
  if (alert.id.startsWith("tc-")) {
    return alert.summary.length > 10 && /\d/.test(alert.summary);
  }

  const summary = alert.summary.trim();
  if (summary.length < 40) return false;
  if (isNavSlop(summary)) return false;
  if (isNavSlop(alert.title)) return false;

  const titleNorm = alert.title.toLowerCase().replace(/\s+/g, " ").trim();
  const summaryNorm = summary.toLowerCase().replace(/\s+/g, " ").trim();
  if (titleNorm === summaryNorm) return false;

  if (!REQUIRES_SUBSTANCE.test(summary) && alert.source === "PAGASA") return false;
  if (alert.source === "GDACS" && summary.length < 40) return false;

  return true;
}

export function filterSubstantiveAlerts<T extends AlertLike>(alerts: T[]): T[] {
  return alerts.filter(isSubstantiveAlert);
}
