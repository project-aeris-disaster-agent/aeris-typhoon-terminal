/** @jest-environment node */

import { computeDedupeHash, normalizeDescription } from "@/lib/dedupe-hash";
import { triageReportDeterministic } from "@/services/ai-triage";

describe("dedupe-hash", () => {
  it("normalizes descriptions consistently", () => {
    expect(normalizeDescription("  Hello!!! World  ")).toBe("hello world");
  });

  it("produces stable hashes for the same report payload", async () => {
    const input = {
      category: "flood",
      description: "Water rising near school",
      position: [121.0244, 14.5547] as [number, number],
    };
    const a = await computeDedupeHash(input);
    const b = await computeDedupeHash(input);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe("ai-triage deterministic", () => {
  it("flags SOS category as urgent", async () => {
    const result = await triageReportDeterministic({
      id: "1",
      category: "SOS",
      description: "Family trapped on roof",
      position: [121.02, 14.55],
    });
    expect(result.priority).toBe("urgent");
    expect(result.isSpam).toBe(false);
  });

  it("rejects obvious spam", async () => {
    const result = await triageReportDeterministic({
      id: "2",
      category: "flood",
      description: "test test test",
      position: [121.02, 14.55],
    });
    expect(result.priority).toBe("rejected");
    expect(result.isSpam).toBe(true);
  });

  it("rejects duplicates when duplicate id provided", async () => {
    const result = await triageReportDeterministic(
      {
        id: "3",
        category: "flood",
        description: "Street flooded knee deep",
        position: [121.02, 14.55],
      },
      "existing-report-id",
    );
    expect(result.priority).toBe("rejected");
    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateOfId).toBe("existing-report-id");
  });

  it("classifies routine reports as low_priority", async () => {
    const result = await triageReportDeterministic({
      id: "4",
      category: "road_closed",
      description: "Main road blocked by fallen tree near barangay hall",
      position: [121.02, 14.55],
    });
    expect(result.priority).toBe("low_priority");
  });
});
