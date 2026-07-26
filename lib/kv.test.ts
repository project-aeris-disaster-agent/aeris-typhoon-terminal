/** @jest-environment node */

import { memoryStoreSize, store, sweepMemoryStore } from "@/lib/kv";

// No KV env is set under jest, so `store` is the in-memory fallback — the same
// code path that serves production whenever KV is unprovisioned.

describe("kv in-memory fallback", () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
    sweepMemoryStore();
  });

  it("reclaims expired entries that are never read back", async () => {
    // The rate limiter only ever incr()s and expire()s its keys — it never
    // get()s them, and each fixed window produces a brand-new key. Lazy
    // expiry-on-read therefore never fires, so without an explicit sweep these
    // entries accumulate for the lifetime of the lambda instance.
    let clock = 1_000_000;
    Date.now = () => clock;

    const before = memoryStoreSize();
    for (let i = 0; i < 200; i += 1) {
      const key = `rl:test-route:203.0.113.${i}:${Math.floor(clock / 1000 / 60)}`;
      await store.incr(key);
      await store.expire(key, 60);
    }
    expect(memoryStoreSize()).toBe(before + 200);

    // Advance past the window; every key above is now expired.
    clock += 61_000;
    sweepMemoryStore();

    expect(memoryStoreSize()).toBe(before);
  });

  it("keeps entries that have not expired yet", async () => {
    let clock = 2_000_000;
    Date.now = () => clock;

    await store.set("kv-test:live", "value", 300);
    const size = memoryStoreSize();

    clock += 60_000;
    sweepMemoryStore();

    expect(memoryStoreSize()).toBe(size);
    expect(await store.get("kv-test:live")).toBe("value");
  });

  it("still expires on read", async () => {
    let clock = 3_000_000;
    Date.now = () => clock;

    await store.set("kv-test:short", "value", 10);
    expect(await store.get("kv-test:short")).toBe("value");

    clock += 11_000;
    expect(await store.get("kv-test:short")).toBeNull();
  });

  it("increments within a window and resets in the next one", async () => {
    let clock = 4_000_000;
    Date.now = () => clock;

    const key = "kv-test:counter";
    expect(await store.incr(key)).toBe(1);
    await store.expire(key, 60);
    expect(await store.incr(key)).toBe(2);
    expect(await store.incr(key)).toBe(3);

    clock += 61_000;
    sweepMemoryStore();
    expect(await store.incr(key)).toBe(1);
  });

  it("bounds list growth via ltrim", async () => {
    await store.ltrim("kv-test:list", 1, 0); // clear
    for (let i = 0; i < 10; i += 1) {
      await store.lpush("kv-test:list", `item-${i}`);
      await store.ltrim("kv-test:list", 0, 4);
    }
    expect((await store.lrange("kv-test:list", 0, -1)).length).toBe(5);
  });
});
