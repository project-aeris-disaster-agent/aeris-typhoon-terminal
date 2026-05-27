import { exaggerateMouthLevel } from "@/lib/vrm/idle-face";

describe("exaggerateMouthLevel", () => {
  it("boosts mid-level input above linear", () => {
    expect(exaggerateMouthLevel(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps to 1", () => {
    expect(exaggerateMouthLevel(1)).toBe(1);
    expect(exaggerateMouthLevel(2)).toBe(1);
  });

  it("returns 0 for silence", () => {
    expect(exaggerateMouthLevel(0)).toBe(0);
  });
});
