import { createBlinkState, updateBlinkWeight } from "@/lib/vrm/blink";

describe("updateBlinkWeight", () => {
  it("returns 0 while speaking", () => {
    const state = createBlinkState(0);
    state.nextBlinkAt = 0;
    expect(updateBlinkWeight(5, state, true)).toBe(0);
  });

  it("ramps up and down through a blink cycle", () => {
    const state = createBlinkState(0);
    state.nextBlinkAt = 0;

    updateBlinkWeight(0, state, false);
    const closing = updateBlinkWeight(0.05, state, false);
    expect(closing).toBeGreaterThan(0);
    expect(closing).toBeLessThanOrEqual(1);

    const openMid = updateBlinkWeight(0.15, state, false);
    expect(openMid).toBeGreaterThanOrEqual(0);
    expect(openMid).toBeLessThanOrEqual(1);

    updateBlinkWeight(0.25, state, false);
    expect(state.phase).toBe("idle");
    expect(updateBlinkWeight(0.26, state, false)).toBe(0);
  });
});
