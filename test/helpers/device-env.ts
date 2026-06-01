export type DeviceSignals = {
  coarse?: boolean;
  reducedMotion?: boolean;
  cores?: number;
  deviceMemory?: number;
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
};

export function installDeviceSignals(signals: DeviceSignals) {
  const coarse = signals.coarse ?? false;
  const reducedMotion = signals.reducedMotion ?? false;
  Object.defineProperty(window, "matchMedia", {
    value: jest.fn((query: string) => ({
      matches: query.includes("coarse")
        ? coarse
        : query.includes("prefers-reduced-motion")
          ? reducedMotion
          : false,
      media: query,
    })),
    configurable: true,
  });
  Object.defineProperty(navigator, "hardwareConcurrency", {
    value: signals.cores ?? 4,
    configurable: true,
  });
  if (signals.deviceMemory !== undefined) {
    Object.defineProperty(navigator, "deviceMemory", {
      value: signals.deviceMemory,
      configurable: true,
    });
  }
  Object.defineProperty(window, "innerWidth", {
    value: signals.innerWidth ?? 1024,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: signals.innerHeight ?? 768,
    configurable: true,
  });
  if (signals.devicePixelRatio !== undefined) {
    Object.defineProperty(window, "devicePixelRatio", {
      value: signals.devicePixelRatio,
      configurable: true,
    });
  }
}
