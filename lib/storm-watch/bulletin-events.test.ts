import {
  classifyBulletinEvent,
  diffPagasaBulletinEvents,
} from "@/lib/storm-watch/bulletin-events";
import type { PagasaBulletins } from "@/lib/pagasa-bulletins";
import type { StormWatchCycleRow } from "@/lib/storm-watch/types";

function bulletin(
  name: string,
  number: number,
  final = false,
): PagasaBulletins["bulletins"][number] {
  return {
    name,
    number,
    final,
    file: `TCB#${number}_${name.toLowerCase()}.pdf`,
    pdfUrl: `https://pubfiles.pagasa.dost.gov.ph/tcb/${number}.pdf`,
  };
}

describe("storm-watch bulletin events", () => {
  it("classifies first bulletin as entered_par", () => {
    expect(classifyBulletinEvent(bulletin("Ester", 1), null)).toBe("entered_par");
  });

  it("classifies incremented bulletin as bulletin_update", () => {
    const previous: StormWatchCycleRow = {
      cyclone_slug: "ester",
      cyclone_name: "Ester",
      last_bulletin_number: 2,
      last_bulletin_final: false,
      last_pdf_url: null,
      cycle_status: "active",
      entered_par_at: "2026-06-22T00:00:00.000Z",
      completed_at: null,
      updated_at: "2026-06-22T00:00:00.000Z",
    };
    expect(classifyBulletinEvent(bulletin("Ester", 3), previous)).toBe(
      "bulletin_update",
    );
    expect(classifyBulletinEvent(bulletin("Ester", 2), previous)).toBeNull();
  });

  it("detects new cyclone from pagasa payload", () => {
    const payload: PagasaBulletins = {
      source: "pagasa-bulletins",
      via: "test",
      fetchedAt: "2026-06-22T12:00:00.000Z",
      hasActive: true,
      bulletins: [bulletin("Ester", 1)],
    };
    const events = diffPagasaBulletinEvents(payload, new Map());
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("entered_par");
  });

  it("emits final bulletin for active cycle", () => {
    const payload: PagasaBulletins = {
      source: "pagasa-bulletins",
      via: "test",
      fetchedAt: "2026-06-22T12:00:00.000Z",
      hasActive: false,
      bulletins: [bulletin("Ester", 8, true)],
    };
    const cycles = new Map<string, StormWatchCycleRow>([
      [
        "ester",
        {
          cyclone_slug: "ester",
          cyclone_name: "Ester",
          last_bulletin_number: 7,
          last_bulletin_final: false,
          last_pdf_url: null,
          cycle_status: "active",
          entered_par_at: "2026-06-22T00:00:00.000Z",
          completed_at: null,
          updated_at: "2026-06-22T00:00:00.000Z",
        },
      ],
    ]);
    const events = diffPagasaBulletinEvents(payload, cycles);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("final");
  });
});
