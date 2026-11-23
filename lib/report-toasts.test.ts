import { pickToastReports } from "./report-toasts";
import type { IncidentReport } from "@/services/reports-client";

function report(id: string, aiPriority?: IncidentReport["aiPriority"], minutesAgo = 0): IncidentReport {
  return {
    id,
    category: "flood",
    description: `report ${id}`,
    position: [123.19, 13.62],
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    confirmations: 0,
    aiPriority,
  } as IncidentReport;
}

describe("pickToastReports", () => {
  it("never toasts on the first poll (existing backlog)", () => {
    const { seen, fresh } = pickToastReports(null, [report("a", "urgent"), report("b")]);
    expect(fresh).toEqual([]);
    expect([...(seen ?? [])].sort()).toEqual(["a", "b"]);
  });

  it("does not treat an empty first poll as the baseline", () => {
    const blip = pickToastReports(null, []);
    expect(blip.seen).toBeNull();
    const { fresh } = pickToastReports(blip.seen, [report("a", "urgent"), report("b", "urgent")]);
    expect(fresh).toEqual([]);
  });

  it("toasts only new urgent reports, newest first", () => {
    const first = pickToastReports(null, [report("a", "urgent")]);
    const { fresh } = pickToastReports(first.seen, [
      report("a", "urgent"),
      report("b", "low_priority"),
      report("c", "urgent", 5),
      report("d", "urgent", 1),
      report("e", "pending"),
    ]);
    expect(fresh.map((r) => r.id)).toEqual(["d", "c"]);
  });

  it("does not mutate the seen-set it was given", () => {
    const first = pickToastReports(null, [report("a")]);
    const before = new Set(first.seen ?? []);
    pickToastReports(first.seen, [report("a"), report("z", "urgent")]);
    expect(first.seen).toEqual(before);
  });
});
