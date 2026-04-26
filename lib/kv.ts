import { kv } from "@vercel/kv";

/**
 * Vercel KV client wrapper. In local dev without KV credentials, we fall
 * back to an in-memory store so the app remains runnable.
 */

type Store = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
};

const memory: Map<string, { value: unknown; expiresAt?: number }> = new Map();
const memoryLists: Map<string, string[]> = new Map();

function isKvConfigured(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
  );
}

function now() {
  return Date.now();
}

const memoryStore: Store = {
  async get<T>(key: string): Promise<T | null> {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < now()) {
      memory.delete(key);
      return null;
    }
    return entry.value as T;
  },
  async set(key, value, ttlSeconds) {
    memory.set(key, {
      value,
      expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : undefined,
    });
  },
  async del(key) {
    memory.delete(key);
  },
  async lpush(key, value) {
    const list = memoryLists.get(key) ?? [];
    list.unshift(value);
    memoryLists.set(key, list);
  },
  async lrange(key, start, stop) {
    const list = memoryLists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  },
  async ltrim(key, start, stop) {
    const list = memoryLists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    memoryLists.set(key, list.slice(start, end));
  },
  async incr(key) {
    const entry = memory.get(key);
    const current =
      entry && (!entry.expiresAt || entry.expiresAt >= now())
        ? Number(entry.value ?? 0)
        : 0;
    const cur = current + 1;
    memory.set(key, {
      value: cur,
      expiresAt: entry?.expiresAt,
    });
    return cur;
  },
  async expire(key, seconds) {
    const entry = memory.get(key);
    if (!entry) return;
    entry.expiresAt = now() + seconds * 1000;
    memory.set(key, entry);
  },
};

const kvStore: Store = {
  async get<T>(key: string) {
    return (await kv.get<T>(key)) ?? null;
  },
  async set(key, value, ttlSeconds) {
    if (ttlSeconds) {
      await kv.set(key, value, { ex: ttlSeconds });
    } else {
      await kv.set(key, value);
    }
  },
  async del(key) {
    await kv.del(key);
  },
  async lpush(key, value) {
    await kv.lpush(key, value);
  },
  async lrange(key, start, stop) {
    return (await kv.lrange(key, start, stop)) as string[];
  },
  async ltrim(key, start, stop) {
    await kv.ltrim(key, start, stop);
  },
  async incr(key) {
    return (await kv.incr(key)) as number;
  },
  async expire(key, seconds) {
    await kv.expire(key, seconds);
  },
};

export const store: Store = isKvConfigured() ? kvStore : memoryStore;
export const kvEnabled = isKvConfigured();
