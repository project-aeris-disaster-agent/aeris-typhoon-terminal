import { attachMapUrlSync, readUrlState, writeUrlState } from "./url-state";

describe("url-state", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "http://localhost/");
  });

  it("returns null state when the hash is empty or invalid", () => {
    expect(readUrlState()).toEqual({
      viewport: null,
      panels: null,
      mode: null,
    });

    window.history.replaceState(null, "", "http://localhost/#v=nope&p=&m=weird");

    expect(readUrlState()).toEqual({
      viewport: null,
      panels: null,
      mode: null,
    });
  });

  it("parses valid viewport, panels, and mode from the hash", () => {
    window.history.replaceState(
      null,
      "",
      "http://localhost/#v=123.456,10.987,8.25&p=hazard,alerts&m=3d",
    );

    expect(readUrlState()).toEqual({
      viewport: { lng: 123.456, lat: 10.987, zoom: 8.25 },
      panels: ["hazard", "alerts"],
      mode: "3d",
    });
  });

  it("merges with the current hash and rounds viewport precision on write", () => {
    window.history.replaceState(null, "", "http://localhost/#p=hazard,alerts&m=2d");

    writeUrlState({
      viewport: { lng: 123.45678, lat: 10.98765, zoom: 8.234 },
    });

    expect(window.location.hash).toBe("#v=123.457%2C10.988%2C8.23&p=hazard%2Calerts&m=2d");
  });

  it("syncs map move events to the URL and applies an initial viewport", () => {
    jest.useFakeTimers();
    window.history.replaceState(null, "", "http://localhost/#v=121.123,14.456,9.87");

    const listeners: Record<string, () => void> = {};
    const map = {
      on: jest.fn((event: string, handler: () => void) => {
        listeners[event] = handler;
      }),
      getCenter: jest.fn(() => ({ lng: 124.1119, lat: 11.2229 })),
      getZoom: jest.fn(() => 7.891),
      jumpTo: jest.fn(),
    };

    attachMapUrlSync(map as never);

    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [121.123, 14.456],
      zoom: 9.87,
    });

    listeners.moveend();
    listeners.moveend();
    jest.advanceTimersByTime(299);
    expect(window.location.hash).toBe("#v=121.123,14.456,9.87");

    jest.advanceTimersByTime(1);
    expect(window.location.hash).toBe("#v=124.112%2C11.223%2C7.89");

    jest.useRealTimers();
  });
});
