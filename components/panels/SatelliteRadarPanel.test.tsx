import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatelliteRadarPanel } from "./SatelliteRadarPanel";
import type {
  LiveWeatherFrameDetail,
  LiveWeatherStatusDetail,
} from "@/services/live-weather-overlay";

const mockFetchRadarFrames = jest.fn();
const mockGibsAnimationFrames = jest.fn();
const mockSetLiveWeatherImagerySource = jest.fn();

jest.mock("@/services/satellite-frames", () => ({
  fetchRadarFrames: (...args: unknown[]) => mockFetchRadarFrames(...args),
  gibsAnimationFrames: (...args: unknown[]) => mockGibsAnimationFrames(...args),
  getLiveWeatherSourceContract: (source: string) => ({
    source,
    staleAfterMinutes: source === "radar" ? 35 : 90,
    attribution: `attribution:${source}`,
  }),
}));

jest.mock("@/services/live-weather-overlay", () => ({
  LIVE_WEATHER_STATUS_EVENT: "aeris:live-weather-status",
  setLiveWeatherImagerySource: (...args: unknown[]) =>
    mockSetLiveWeatherImagerySource(...args),
}));

describe("SatelliteRadarPanel", () => {
  beforeEach(() => {
    mockFetchRadarFrames.mockReset();
    mockGibsAnimationFrames.mockReset();
    mockSetLiveWeatherImagerySource.mockReset();
    mockFetchRadarFrames.mockResolvedValue({
      frames: [
        {
          time: "2026-05-05T00:00:00.000Z",
          path: "https://example.test/radar",
          kind: "observed",
        },
      ],
    });
    mockGibsAnimationFrames.mockReturnValue([
      { time: "2026-05-05T00:00:00.000Z", path: "", kind: "observed" },
      { time: "2026-05-05T00:10:00.000Z", path: "", kind: "observed" },
    ]);
  });

  it("switches sources by their renamed labels and notifies the overlay service", async () => {
    const user = userEvent.setup();
    render(<SatelliteRadarPanel map={{} as never} />);

    expect(mockSetLiveWeatherImagerySource).toHaveBeenCalledWith(
      expect.anything(),
      "radar",
    );
    await user.click(
      screen.getByRole("button", { name: /Infrared \(Band 13\)/i }),
    );
    expect(mockSetLiveWeatherImagerySource).toHaveBeenLastCalledWith(
      expect.anything(),
      "himawari-ir",
    );
    await user.click(
      screen.getByRole("button", { name: /Air Mass \(false color\)/i }),
    );
    expect(mockSetLiveWeatherImagerySource).toHaveBeenLastCalledWith(
      expect.anything(),
      "himawari-airmass",
    );
  });

  it("shows fallback status only for the active source", async () => {
    render(<SatelliteRadarPanel map={{} as never} />);

    const ignoredDetail: LiveWeatherStatusDetail = {
      source: "himawari-ir",
      health: "delayed",
      frameAgeMinutes: 18,
      message: "Ignored status",
      clampedToPublishedFrame: false,
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aeris:live-weather-status", { detail: ignoredDetail }),
      );
    });
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Ignored status")).not.toBeInTheDocument();

    const activeDetail: LiveWeatherStatusDetail = {
      source: "radar",
      health: "fallback",
      frameAgeMinutes: 42,
      message: "Radar refresh failed; showing last-known-good frame.",
      clampedToPublishedFrame: false,
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aeris:live-weather-status", { detail: activeDetail }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Fallback")).toBeInTheDocument();
    });
    expect(screen.getByText(/Radar refresh failed/)).toBeInTheDocument();
    expect(screen.getByText(/42m stale/)).toBeInTheDocument();
  });

  it("flags forecast (nowcast) frames with a Forecast badge for the active source", async () => {
    render(<SatelliteRadarPanel map={{} as never} />);

    const forecastFrame: LiveWeatherFrameDetail = {
      index: 12,
      count: 13,
      time: "2026-05-05T00:30:00.000Z",
      source: "radar",
      kind: "nowcast",
      attribution: "RainViewer Radar",
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aeris:live-weather-frame", { detail: forecastFrame }),
      );
    });
    expect(screen.getByText("Forecast")).toBeInTheDocument();

    const observedFrame: LiveWeatherFrameDetail = {
      ...forecastFrame,
      time: "2026-05-05T00:40:00.000Z",
      kind: "observed",
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aeris:live-weather-frame", { detail: observedFrame }),
      );
    });
    expect(screen.queryByText("Forecast")).not.toBeInTheDocument();
  });

  it("ignores frame events from a non-active source", async () => {
    render(<SatelliteRadarPanel map={{} as never} />);

    const otherSourceFrame: LiveWeatherFrameDetail = {
      index: 1,
      count: 5,
      time: "2026-05-05T00:30:00.000Z",
      source: "himawari-ir",
      kind: "nowcast",
      attribution: "RainViewer Infrared",
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("aeris:live-weather-frame", { detail: otherSourceFrame }),
      );
    });
    expect(screen.queryByText("Forecast")).not.toBeInTheDocument();
  });
});
