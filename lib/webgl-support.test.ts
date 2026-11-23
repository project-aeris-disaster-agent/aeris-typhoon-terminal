/** @jest-environment jsdom */

import { detectWebglSupport } from "@/lib/webgl-support";

describe("detectWebglSupport", () => {
  const original = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
  });

  function stubGetContext(impl: (id: string) => unknown) {
    HTMLCanvasElement.prototype.getContext =
      impl as unknown as typeof HTMLCanvasElement.prototype.getContext;
  }

  it("reports available when a context is returned", () => {
    const loseContext = jest.fn();
    stubGetContext((id) =>
      id === "webgl2"
        ? { getExtension: () => ({ loseContext }) }
        : null,
    );
    expect(detectWebglSupport()).toBe("available");
    // Browsers cap simultaneous WebGL contexts; leaking one per probe would
    // eventually be the thing that breaks the map.
    expect(loseContext).toHaveBeenCalled();
  });

  it("falls back to webgl1 when webgl2 is absent", () => {
    stubGetContext((id) =>
      id === "webgl" ? { getExtension: () => null } : null,
    );
    expect(detectWebglSupport()).toBe("available");
  });

  // The reported production failure: GL_VENDOR/GL_RENDERER "Disabled", i.e.
  // hardware acceleration off or the GPU blocklisted. getContext returns null.
  it("reports unavailable when no context can be created", () => {
    stubGetContext(() => null);
    expect(detectWebglSupport()).toBe("unavailable");
  });

  it("reports unavailable when getContext throws", () => {
    stubGetContext(() => {
      throw new Error("blocked by policy");
    });
    expect(detectWebglSupport()).toBe("unavailable");
  });

  it("tolerates a missing WEBGL_lose_context extension", () => {
    stubGetContext(() => ({ getExtension: () => undefined }));
    expect(detectWebglSupport()).toBe("available");
  });
});
