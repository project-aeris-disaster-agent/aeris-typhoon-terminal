import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatelliteRadarPanel } from "./SatelliteRadarPanel";
import type { LiveWeatherStatusDetail } from "@/services/live-weather-overlay";

const mockFetchRadarFrames = jest.fn();
const mockGibsAnimationFrames = jest.fn();
const mockSetLiveWeatherImagerySource = jest.fn();

jest.mock("@/services/satellite-frames", () => ({
  fetchRadarFrames: (...args: unknown[]) => mockFetchRadarFrames(...args),
  gibsAnimationFrames: (...args: unknown[]) => mockGibsAnimationFrames(...args),
  getLiveWeatherSourceContract: (source: string) => ({
    source,
    staleAfterMinutes: source === "radar" ? 35 : 90,
  }),
}));

jest.mock("@/services/live-weather-overlay", () => ({
  LIVE_WEATHER_STATUS_EVENT: "aeris:live-weather-status",
  setLiveWeatherImagerySource: (...args: unknown[]) => mockSetLiveWeatherImagerySource(...args),
}));

describe("SatelliteRadarPanel", () => {
  beforeEach(() => {
    mockFetchRadarFrames.mockReset();
    mockGibsAnimationFrames.mockReset();
    mockSetLiveWeatherImagerySource.mockReset();
    mockFetchRadarFrames.mockResolvedValue({
      frames: [{ time: "2026-05-05T00:00:00.000Z", path: "https://example.test/radar" }],
    });
    mockGibsAnimationFrames.mockReturnValue([
      { time: "2026-05-05T00:00:00.000Z", path: "" },
      { time: "2026-05-05T00:10:00.000Z", path: "" },
    ]);
  });

  it("switches sources and notifies the overlay service", async () => {
    const user = userEvent.setup();
    render(<SatelliteRadarPanel map={{} as never} />);

    expect(mockSetLiveWeatherImagerySource).toHaveBeenCalledWith(expect.anything(), "radar");
    await user.click(screen.getByRole("button", { name: /Satellite infrared/i }));
    expect(mockSetLiveWeatherImagerySource).toHaveBeenLastCalledWith(
      expect.anything(),
      "himawari-ir",
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
    expect(screen.getByText(/Frame age 42m \(stale\)/)).toBeInTheDocument();
  });
});
