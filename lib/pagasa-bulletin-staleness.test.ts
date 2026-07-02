import {
  filterStaleBulletins,
  isBulletinStale,
} from "@/lib/pagasa-bulletin-staleness";
import type { PagasaBulletin, PagasaBulletins } from "@/lib/pagasa-bulletins";
import { cycloneSlug, type StormWatchCycleRow } from "@/lib/storm-watch/types";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function bulletin(name: string, number: number, final = false): PagasaBulletin {
  return {
    name,
    number,
    final,
    file: `TCB#${number}_${name.toLowerCase()}.pdf`,
    pdfUrl: `https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%23${number}_${name.toLowerCase()}.pdf`,
  };
}

function cycle(
  name: string,
  lastNumber: number,
  updatedAgoMs: number,
  overrides: Partial<StormWatchCycleRow> = {},
): StormWatchCycleRow {
  return {
    cyclone_slug: cycloneSlug(name),
    cyclone_name: name,
    last_bulletin_number: lastNumber,
    last_bulletin_final: false,
    last_pdf_url: null,
    cycle_status: "active",
    entered_par_at: null,
    completed_at: null,
    updated_at: new Date(NOW - updatedAgoMs).toISOString(),
    ...overrides,
  };
}

function map(...rows: StormWatchCycleRow[]) {
  return new Map(rows.map((r) => [r.cyclone_slug, r]));
}

describe("isBulletinStale", () => {
  it("keeps a bulletin with no recorded cycle history (fail open)", () => {
    expect(isBulletinStale(bulletin("Francisco", 21), map(), NOW, 3)).toBe(false);
  });

  it("hides a system whose bulletin has not advanced in > N days", () => {
    const cycles = map(cycle("Francisco", 21, 5 * DAY));
    expect(isBulletinStale(bulletin("Francisco", 21), cycles, NOW, 3)).toBe(true);
  });

  it("keeps a system that advanced recently", () => {
    const cycles = map(cycle("Ester", 6, 2 * DAY));
    expect(isBulletinStale(bulletin("Ester", 6), cycles, NOW, 3)).toBe(false);
  });

  it("keeps a bulletin the parser advanced beyond our last record", () => {
    // Cycle recorded #21 five days ago, but the parser now shows #22 — a fresh
    // advance the cron has not processed yet. Must not be hidden.
    const cycles = map(cycle("Francisco", 21, 5 * DAY));
    expect(isBulletinStale(bulletin("Francisco", 22), cycles, NOW, 3)).toBe(false);
  });

  it("keeps a bulletin exactly at the threshold (only strictly older is stale)", () => {
    const cycles = map(cycle("Francisco", 21, 3 * DAY));
    expect(isBulletinStale(bulletin("Francisco", 21), cycles, NOW, 3)).toBe(false);
  });
});

describe("filterStaleBulletins", () => {
  const payload = (bulletins: PagasaBulletin[]): PagasaBulletins => ({
    source: "pagasa-bulletins",
    via: "test",
    fetchedAt: new Date(NOW).toISOString(),
    hasActive: bulletins.some((b) => !b.final),
    bulletins,
  });

  it("drops the stale system and recomputes hasActive", () => {
    const input = payload([bulletin("Francisco", 21)]);
    const cycles = [cycle("Francisco", 21, 5 * DAY)];

    const out = filterStaleBulletins(input, cycles, { nowMs: NOW, staleDays: 3 });
    expect(out.bulletins).toHaveLength(0);
    expect(out.hasActive).toBe(false);
  });

  it("returns the original object unchanged when nothing is stale (no-op)", () => {
    const input = payload([bulletin("Ester", 6)]);
    const cycles = [cycle("Ester", 6, 1 * DAY)];

    const out = filterStaleBulletins(input, cycles, { nowMs: NOW, staleDays: 3 });
    expect(out).toBe(input);
  });

  it("keeps active systems while dropping only the stale one", () => {
    const input = payload([bulletin("Francisco", 21), bulletin("Ester", 6)]);
    const cycles = [cycle("Francisco", 21, 5 * DAY), cycle("Ester", 6, 2 * DAY)];

    const out = filterStaleBulletins(input, cycles, { nowMs: NOW, staleDays: 3 });
    expect(out.bulletins.map((b) => b.name)).toEqual(["Ester"]);
    expect(out.hasActive).toBe(true);
  });
});
