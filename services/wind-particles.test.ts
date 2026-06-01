/** @jest-environment jsdom */
export {};

import { WindParticleCanvas } from "./wind-particles";
import { createMapStub, createWindFieldPayload } from "@/test/helpers/map-stub";
import { installDeviceSignals } from "@/test/helpers/device-env";
import { windDprCapForTier } from "@/lib/device-tier";
import { installCanvas2dShim } from "@/test/helpers/canvas-2d-shim";

describe("WindParticleCanvas", () => {
  beforeAll(() => {
    installCanvas2dShim();
  });
  let rafQueue: FrameRequestCallback[] = [];
  let rafId = 0;

  beforeEach(() => {
    rafQueue = [];
    rafId = 0;
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafQueue.push(cb);
      rafId += 1;
      return rafId;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      rafQueue = [];
    });
    installDeviceSignals({ devicePixelRatio: 2, coarse: false });
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function flushRaf(now = 0) {
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const cb of batch) cb(now);
  }

  it("mounts a screen-blended canvas in the map container", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 8 });
    const canvas = map.getContainer().querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.style.mixBlendMode).toBe("screen");
    wind.destroy();
  });

  it("caps backing store dimensions by device tier DPR", () => {
    const map = createMapStub(undefined, { width: 400, height: 300 });
    const wind = new WindParticleCanvas(map, { particleCount: 4 });
    wind.setDeviceTier("low");
    const canvas = map.getContainer().querySelector("canvas")!;
    const cap = windDprCapForTier("low");
    expect(canvas.width).toBe(Math.floor(400 * cap));
    expect(canvas.height).toBe(Math.floor(300 * cap));
    wind.destroy();
  });

  it("draws fewer streaks over the same interval in performance than quality", () => {
    function countStrokes(profile: "performance" | "quality") {
      const map = createMapStub();
      const wind = new WindParticleCanvas(map, { particleCount: 32 });
      wind.setField(createWindFieldPayload());
      wind.setPerformanceProfile(profile);
      wind.setVisible(true);
      const ctx = map.getContainer().querySelector("canvas")!.getContext("2d")!;
      let strokes = 0;
      const baseStroke = ctx.stroke.bind(ctx);
      ctx.stroke = (...args: Parameters<CanvasRenderingContext2D["stroke"]>) => {
        strokes += 1;
        return baseStroke(...args);
      };
      for (const t of [0, 16, 32, 48, 64, 80, 96, 112]) {
        flushRaf(t);
      }
      wind.destroy();
      return strokes;
    }
    expect(countStrokes("performance")).toBeLessThan(countStrokes("quality"));
  });

  it("hides canvas and stops scheduling new frames when setVisible(false)", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 4 });
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;
    wind.setVisible(true);
    flushRaf(0);
    wind.setVisible(false);
    expect(canvas.style.opacity).toBe("0");
    const depthAfterStop = rafQueue.length;
    flushRaf(50);
    expect(rafQueue.length).toBe(depthAfterStop);
    wind.destroy();
  });

  it("does not paint while document.hidden", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 8 });
    wind.setField(createWindFieldPayload());
    wind.setVisible(true);
    flushRaf(0);
    flushRaf(50);
    const canvas = map.getContainer().querySelector("canvas")!;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    let fills = 0;
    const baseFill = ctx.fillRect.bind(ctx);
    ctx.fillRect = (...args: Parameters<CanvasRenderingContext2D["fillRect"]>) => {
      fills += 1;
      return baseFill(...args);
    };
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    flushRaf(100);
    flushRaf(200);
    expect(fills).toBe(0);
    wind.destroy();
  });

  it("pause and resume without toggling visibility", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 4 });
    wind.setVisible(true);
    flushRaf(0);
    wind.pause();
    const queued = rafQueue.length;
    flushRaf(100);
    expect(rafQueue.length).toBe(queued);
    wind.resume();
    flushRaf(200);
    expect(rafQueue.length).toBeGreaterThan(0);
    wind.destroy();
  });

  it("advects particles when a wind field is set", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 1 });
    wind.setField(createWindFieldPayload());
    wind.setVisible(true);
    flushRaf(0);
    flushRaf(100);
    flushRaf(200);
    const canvas = map.getContainer().querySelector("canvas")!;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const lit = [...image.data].some((v, i) => i % 4 === 3 && v > 0);
    expect(lit).toBe(true);
    wind.destroy();
  });

  it("removes canvas on destroy", () => {
    const map = createMapStub();
    const wind = new WindParticleCanvas(map, { particleCount: 4 });
    wind.destroy();
    expect(map.getContainer().querySelector("canvas")).toBeNull();
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
