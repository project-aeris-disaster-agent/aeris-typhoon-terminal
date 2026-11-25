import { render, screen } from "@testing-library/react";

/**
 * Regression cover for the production outage: MapLibre's `new Map()` throws
 * synchronously when it cannot get a WebGL context, and that throw escaped
 * Map2D's effect and tore down the whole dashboard —
 * "Application error: a client-side exception has occurred", with the alerts
 * feed, live reports, typhoon bulletins and news dying alongside the map.
 *
 * The map is one panel, not the product. These tests pin that a WebGL failure
 * stays inside Map2D.
 */

const mapConstructor = jest.fn();

jest.mock("maplibre-gl", () => ({
  __esModule: true,
  Map: jest.fn().mockImplementation((...args: unknown[]) => mapConstructor(...args)),
  AttributionControl: jest.fn(),
  NavigationControl: jest.fn(),
  ScaleControl: jest.fn(),
}));

jest.mock("@/lib/maplibre-worker", () => ({ configureMaplibreWorker: jest.fn() }));

jest.mock("@/lib/webgl-support", () => ({
  detectWebglSupport: jest.fn(),
}));

// Style/overlay wiring is irrelevant here and pulls in the whole map stack.
jest.mock("@/services/map-basemap", () => ({ ensureBasemapOverlays: jest.fn() }));
jest.mock("@/services/map-style-reattach", () => ({
  reattachMapOverlaysAfterStyleChange: jest.fn(),
}));
jest.mock("@/services/map-scene", () => ({ applyMapViewMode: jest.fn() }));

import { Map2D } from "./Map2D";
import { detectWebglSupport } from "@/lib/webgl-support";

const mockDetect = detectWebglSupport as jest.Mock;

describe("Map2D — WebGL unavailable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders an explanation instead of throwing when WebGL is unavailable", () => {
    mockDetect.mockReturnValue("unavailable");

    expect(() =>
      render(<Map2D mode="2d" theme="dark" onReady={jest.fn()} />),
    ).not.toThrow();

    expect(screen.getByText("MAP UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText(/hardware acceleration/i)).toBeInTheDocument();
    // The operator must be told the rest of the terminal still works.
    expect(screen.getByText(/Alerts, live reports/i)).toBeInTheDocument();
    // Never even attempt construction — MapLibre would throw.
    expect(mapConstructor).not.toHaveBeenCalled();
  });

  it("survives MapLibre throwing even when the probe passed", () => {
    // Context limits and driver resets mean a successful probe does not
    // guarantee a successful construction.
    mockDetect.mockReturnValue("available");
    mapConstructor.mockImplementation(() => {
      throw new Error("Failed to initialize WebGL");
    });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(<Map2D mode="2d" theme="dark" onReady={jest.fn()} />),
    ).not.toThrow();

    expect(screen.getByText("MAP UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText(/could not start on this device/i)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not call onReady when the map cannot start", () => {
    mockDetect.mockReturnValue("unavailable");
    const onReady = jest.fn();
    render(<Map2D mode="2d" theme="dark" onReady={onReady} />);
    // Panels key off a null map and degrade on their own; a bogus ready
    // signal would hand them a map that does not exist.
    expect(onReady).not.toHaveBeenCalled();
  });
});
