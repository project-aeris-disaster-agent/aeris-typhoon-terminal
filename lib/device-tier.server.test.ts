/** @jest-environment node */
export {};

import { detectDeviceTier, isCoarsePointerDevice } from "./device-tier";

describe("device-tier (server)", () => {
  it("defaults to mid tier when window is unavailable", () => {
    expect(detectDeviceTier()).toBe("mid");
  });

  it("reports non-coarse pointer when window is unavailable", () => {
    expect(isCoarsePointerDevice()).toBe(false);
  });
});
