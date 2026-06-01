type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number };

/**
 * jsdom does not implement Canvas 2D. This installs a minimal 2D context so
 * real overlay code can run in unit tests (browser API shim, not a mock of app code).
 */
export function installCanvas2dShim() {
  const backing = new Map<HTMLCanvasElement, PixelBuffer>();
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

  function bufferFor(canvas: HTMLCanvasElement): PixelBuffer {
    let image = backing.get(canvas);
    if (!image) {
      const w = Math.max(1, canvas.width || 1);
      const h = Math.max(1, canvas.height || 1);
      image = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      backing.set(canvas, image);
    }
    return image;
  }

  HTMLCanvasElement.prototype.getContext = function getContext(type: string) {
    if (type !== "2d") return null;
    const canvas = this as HTMLCanvasElement;
    const cached = contexts.get(canvas);
    if (cached) return cached;
    const image = bufferFor(canvas);
    const ctx = {
      setTransform: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(() => {
        for (let i = 3; i < image.data.length; i += 4) {
          image.data[i] = 40;
        }
      }),
      stroke: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      setLineDash: jest.fn(),
      lineDashOffset: 0,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: image.data.slice(0, w * h * 4),
        width: w,
        height: h,
      }),
    };
    const typed = ctx as unknown as CanvasRenderingContext2D;
    contexts.set(canvas, typed);
    return typed;
  };
}
