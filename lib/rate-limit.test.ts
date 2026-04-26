import { getClientIp, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("limits concurrent requests within the same window and reports remaining quota", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        rateLimit({
          key: "concurrent-user",
          max: 3,
          windowSeconds: 60,
        }),
      ),
    );

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[2].remaining).toBe(0);
    expect(results[3].resetSeconds).toBe(60);
  });

  it("resets the window after the configured time passes", async () => {
    const first = await rateLimit({
      key: "window-reset-user",
      max: 1,
      windowSeconds: 60,
    });
    const second = await rateLimit({
      key: "window-reset-user",
      max: 1,
      windowSeconds: 60,
    });

    jest.setSystemTime(new Date("2026-04-23T00:01:00.000Z"));

    const third = await rateLimit({
      key: "window-reset-user",
      max: 1,
      windowSeconds: 60,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(third.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("prefers the first forwarded ip", () => {
    const req = {
      headers: {
        get(name: string) {
          return (
            {
              "x-forwarded-for": "1.2.3.4, 5.6.7.8",
              "x-real-ip": "9.9.9.9",
            }[name] ?? null
          );
        },
      },
    } as unknown as Request;

    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip and then unknown", () => {
    const realReq = {
      headers: {
        get(name: string) {
          return name === "x-real-ip" ? "9.9.9.9" : null;
        },
      },
    } as unknown as Request;
    const unknownReq = {
      headers: {
        get() {
          return null;
        },
      },
    } as unknown as Request;

    expect(getClientIp(realReq)).toBe("9.9.9.9");
    expect(getClientIp(unknownReq)).toBe("unknown");
  });
});
