/**
 * WebGL availability probe.
 *
 * MapLibre's `new Map()` **throws synchronously** when it cannot get a WebGL
 * context ("Failed to initialize WebGL", type `webglcontextcreationerror`).
 * That happens on real operator machines more often than it sounds: hardware
 * acceleration switched off in browser settings, a blocklisted or remoted GPU
 * (RDP / VDI / VM), an over-strict enterprise policy, or simply too many live
 * WebGL contexts already open in other tabs.
 *
 * Unguarded, that throw escapes React's render and takes down the whole
 * dashboard with "Application error: a client-side exception has occurred" —
 * the alerts feed, live reports, typhoon bulletins and news all die with the
 * map. For a disaster terminal that is the wrong trade: the map is one panel,
 * not the product.
 *
 * Probe before constructing, and let the map degrade alone.
 */

export type WebglStatus = "available" | "unavailable" | "unknown";

/**
 * Try to obtain a WebGL context on a throwaway canvas.
 *
 * Matches the attributes MapLibre requests, so the probe fails in the same
 * cases the real map would rather than passing on a context MapLibre would
 * reject. The context is explicitly released via WEBGL_lose_context: browsers
 * cap simultaneous contexts (~16), and leaking one per probe would eventually
 * be the very thing that breaks the map.
 */
export function detectWebglSupport(): WebglStatus {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "unknown";
  }

  try {
    const canvas = document.createElement("canvas");
    const attributes: WebGLContextAttributes = {
      alpha: true,
      depth: true,
      stencil: true,
      antialias: false,
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false,
    };

    const gl =
      (canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl", attributes) as WebGLRenderingContext | null);

    if (!gl) return "unavailable";

    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return "available";
  } catch {
    // Some hardened browsers throw from getContext rather than returning null.
    return "unavailable";
  }
}
