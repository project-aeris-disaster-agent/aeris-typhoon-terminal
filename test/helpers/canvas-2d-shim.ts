type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number };

export type Canvas2dShimContext = {
  __strokeCount: number;
  setTransform: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  fillRect: jest.Mock;
  stroke: jest.Mock;
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  setLineDash: jest.Mock;
  lineDashOffset: number;
  globalCompositeOperation: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  getImageData: (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => { data: Uint8ClampedArray; width: number; height: number };
};

// jsdom has no Canvas 2D API.
export function installCanvas2dShim() {
  const backing = new Map<HTMLCanvasElement, PixelBuffer>();
  const contexts = new WeakMap<HTMLCanvasElement, Canvas2dShimContext>();

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

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function getContext(
    type: string,
    ..._args: unknown[]
  ) {
    if (type !== "2d") {
      return nativeGetContext.call(this, type);
    }
    const canvas = this as HTMLCanvasElement;
    const cached = contexts.get(canvas);
    if (cached) return cached as unknown as CanvasRenderingContext2D;
    const image = bufferFor(canvas);
    const ctx: Canvas2dShimContext = {
      __strokeCount: 0,
      setTransform: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      stroke: jest.fn(function stroke(this: Canvas2dShimContext) {
        this.__strokeCount += 1;
      }),
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
    contexts.set(canvas, ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  };
}
