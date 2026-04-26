import { store } from "./kv";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
};

/**
 * Fixed-window rate limiter keyed by IP. Backed by Vercel KV when available,
 * falls back to an in-memory store for local dev. Not cluster-safe without
 * KV in production.
 */
export async function rateLimit(opts: {
  key: string;
  max: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { key, max, windowSeconds } = opts;
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const fullKey = `rl:${key}:${window}`;
  const count = await store.incr(fullKey);
  if (count === 1) {
    await store.expire(fullKey, windowSeconds);
  }
  const allowed = count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - count),
    resetSeconds: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
  };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
