import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayerLegend, QuickViewsPanel } from "./LayerLegend";
import { FloodAutomationProvider } from "@/components/providers/FloodAutomationProvider";

// Mock the manifest + pack fetches so the dynamic hazard radios render.
// Two packs (Cebu + Metro Manila) lets us prove setActiveFloodPeriod flips
// every matching pack, not just the first one.
beforeAll(() => {
  const manifest = {
    generatedAt: "2026-04-24T00:00:00Z",
    simplifyToleranceDegrees: 0.00025,
    attribution: "MGB",
    packs: [
      {
        province: "Cebu",
        provinceSlug: "cebu",
        psgc: "072200000",
        returnPeriod: "5yr",
        path: "/flood-hazard/cebu-5yr.json",
        bbox: [123.6, 10.1, 124.1, 10.7],
        featureCounts: { low: 1, medium: 1, high: 1 },
        vertices: 10,
        sizeBytes: 100,
        source: "MGB Geohazard Maps (Flo-2D)",
      },
      {
        province: "Metro Manila",
        provinceSlug: "metromanila",
        psgc: "",
        returnPeriod: "5yr",
        path: "/flood-hazard/metromanila-5yr.json",
        bbox: [120.9, 14.3, 121.1, 14.8],
        featureCounts: { low: 1, medium: 1, high: 1 },
        vertices: 10,
        sizeBytes: 100,
        source: "MGB Geohazard Maps (Flo-2D)",
      },
    ],
  };
  const emptyCollection = { type: "FeatureCollection", features: [] };
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.endsWith("index.json")) {
      return {
        ok: true,
        json: async () => manifest,
      } as Response;
    }
    if (href.includes("/api/alerts")) {
      return {
        ok: true,
        json: async () => ({ alerts: [] }),
      } as Response;
    }
    if (href.includes("/api/jtwc")) {
      return {
        ok: true,
        json: async () => ({ storms: [], outsideParGdacs: [] }),
      } as Response;
    }
    const body = emptyCollection;
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
});

function createMapStub() {
  return {
    getLayer: jest.fn(() => ({})),
    getSource: jest.fn(() => undefined),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    hasImage: jest.fn(() => true),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
    setFilter: jest.fn(),
    flyTo: jest.fn(),
    getZoom: jest.fn(() => 9),
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    getStyle: jest.fn(() => ({ layers: [] })),
  };
}

function renderLayerLegend(map: ReturnType<typeof createMapStub>, mode: "2d" | "3d") {
  return render(
    <FloodAutomationProvider selectedLocation={null}>
      <LayerLegend map={map as never} mode={mode} />
    </FloodAutomationProvider>,
  );
}

describe("LayerLegend", () => {
  it("wires hazard, scene toggle, and quick view controls to the map instance", async () => {
    const user = userEvent.setup();
    const map = createMapStub();

    render(
      <>
        <QuickViewsPanel map={map as never} />
        <FloodAutomationProvider selectedLocation={null}>
          <LayerLegend map={map as never} mode="3d" />
        </FloodAutomationProvider>
      </>,
    );

    // Wait for the manifest to resolve and render the flood toggle.
    const floodButton = await screen.findByRole("button", {
      name: /Flood Projections/i,
    });

    map.setLayoutProperty.mockClear();
    map.flyTo.mockClear();

    await user.click(floodButton);
    await waitFor(() => {
      // MapLibre layers stay invisible since the Three.js wireframe is the
      // primary visual. Verify visibility "none" for every pack layer
      // (Cebu + Metro Manila): halo, pattern, tint fill, edge.
      for (const id of [
        "lyr-flood-halo-cebu-5yr",
        "lyr-flood-pattern-cebu-5yr",
        "lyr-flood-fill-cebu-5yr",
        "lyr-flood-edge-cebu-5yr",
        "lyr-flood-halo-metromanila-5yr",
        "lyr-flood-pattern-metromanila-5yr",
        "lyr-flood-fill-metromanila-5yr",
        "lyr-flood-edge-metromanila-5yr",
      ]) {
        expect(map.setLayoutProperty).toHaveBeenCalledWith(
          id,
          "visibility",
          "none",
        );
      }
    });

    // Simulate a scene pack landing with flood-tagged features. This drives
    // setFloodImpactHighlight -> lyr-osm-roads-flood visibility "visible".
    // It must NOT reach for setPaintProperty on lyr-osm-roads (the old,
    // destructive codepath that made sparse-flood regions look empty).
    fireEvent(
      window,
      new CustomEvent("aeris:scene-summary", {
        detail: {
          buildingCount: 10,
          roadCount: 10,
          facilityCount: 3,
          facilitiesByCategory: {},
          floodImpact: {
            buildings: { low: 1, medium: 2, high: 0 },
            roads: { low: 0, medium: 1, high: 0 },
          },
          generatedAt: "2026-04-24T00:00:00Z",
          attribution: "OSM",
        },
      }),
    );
    await waitFor(() => {
      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        "lyr-osm-roads-flood",
        "visibility",
        "visible",
      );
    });
    const roadPaintCalls = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "lyr-osm-roads",
    );
    expect(roadPaintCalls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Cebu" }));
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [123.8854, 10.3157],
        zoom: 12.1,
        pitch: 64,
        bearing: -14,
      }),
    );
  });

  it("in 2D keeps flood halo/pattern hidden and shows fill+edge only", async () => {
    const user = userEvent.setup();
    const map = createMapStub();

    renderLayerLegend(map, "2d");

    const floodButton = await screen.findByRole("button", {
      name: /Flood Projections/i,
    });
    map.setLayoutProperty.mockClear();
    await user.click(floodButton);

    await waitFor(() => {
      for (const id of [
        "lyr-flood-halo-cebu-5yr",
        "lyr-flood-pattern-cebu-5yr",
        "lyr-flood-halo-metromanila-5yr",
        "lyr-flood-pattern-metromanila-5yr",
      ]) {
        expect(map.setLayoutProperty).toHaveBeenCalledWith(
          id,
          "visibility",
          "none",
        );
      }
      for (const id of [
        "lyr-flood-fill-cebu-5yr",
        "lyr-flood-edge-cebu-5yr",
        "lyr-flood-fill-metromanila-5yr",
        "lyr-flood-edge-metromanila-5yr",
      ]) {
        expect(map.setLayoutProperty).toHaveBeenCalledWith(
          id,
          "visibility",
          "visible",
        );
      }
    });
  });

  it("shows a scene warning message when the 3D context pack fails", async () => {
    renderLayerLegend(createMapStub(), "3d");

    fireEvent(
      window,
      new CustomEvent("aeris:scene-status", {
        detail: "3D context pack unavailable for ncr (404).",
      }),
    );

    expect(await screen.findByText("3D context pack unavailable for ncr (404).")).toBeInTheDocument();
  });

  it("collapses and expands the control panel", async () => {
    const user = userEvent.setup();
    renderLayerLegend(createMapStub(), "2d");

    const toggle = screen.getByRole("button", { name: /Layers/ });
    expect(screen.getByText("Hazard")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("Hazard")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("Hazard")).toBeInTheDocument();
  });
});
