/**
 * Mouth level helpers: RMS from Web Audio analyser (Piper) and decay envelope (Web Speech).
 */

export function computeRmsLevel(analyser: AnalyserNode, data: Uint8Array): number {
  // DOM lib types the buffer as ArrayBufferLike; runtime buffer is fine.
  analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  return Math.min(1, rms * 6);
}

export function createMouthLevelLoop(
  getLevel: () => number,
  onLevel: (level: number) => void,
  options?: { decay?: number },
): () => void {
  const decay = options?.decay ?? 0.82;
  let current = 0;
  let rafId = 0;

  const tick = () => {
    const target = getLevel();
    current = Math.max(target, current * decay);
    onLevel(current);
    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);
  return () => window.cancelAnimationFrame(rafId);
}

export type EnvelopeController = {
  pulse: (strength?: number) => void;
  tick: () => number;
  reset: () => void;
};

export function createEnvelopeController(options?: {
  decay?: number;
  pulseStrength?: number;
}): EnvelopeController {
  const decay = options?.decay ?? 0.86;
  const pulseStrength = options?.pulseStrength ?? 0.85;
  let level = 0;

  return {
    pulse(strength = pulseStrength) {
      level = Math.max(level, strength);
    },
    tick() {
      level *= decay;
      if (level < 0.02) level = 0;
      return level;
    },
    reset() {
      level = 0;
    },
  };
}
