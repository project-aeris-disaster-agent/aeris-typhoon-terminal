/**
 * Simple circuit breaker for external APIs. Tracks failures and opens the
 * circuit after threshold, rejecting calls for a cooldown window. Pattern
 * adapted from WorldMonitor's fault tolerance approach.
 */

type BreakerState = {
  failures: number;
  openedAt: number | null;
};

const breakers = new Map<string, BreakerState>();

export type BreakerOptions = {
  threshold?: number;
  cooldownMs?: number;
  timeoutMs?: number;
};

const DEFAULTS: Required<BreakerOptions> = {
  threshold: 3,
  cooldownMs: 60_000,
  timeoutMs: 8_000,
};

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`Circuit open for ${key}`);
    this.name = "CircuitOpenError";
  }
}

export async function withBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: BreakerOptions,
): Promise<T> {
  const cfg = { ...DEFAULTS, ...opts };
  const state = breakers.get(key) ?? { failures: 0, openedAt: null };

  if (state.openedAt !== null) {
    if (Date.now() - state.openedAt < cfg.cooldownMs) {
      throw new CircuitOpenError(key);
    }
    state.openedAt = null;
    state.failures = 0;
  }

  try {
    const result = await withTimeout(fn(), cfg.timeoutMs);
    state.failures = 0;
    breakers.set(key, state);
    return result;
  } catch (err) {
    state.failures += 1;
    if (state.failures >= cfg.threshold) {
      state.openedAt = Date.now();
    }
    breakers.set(key, state);
    throw err;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
