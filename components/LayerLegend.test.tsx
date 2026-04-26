import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayerLegend } from "./LayerLegend";

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
    const body = href.endsWith("index.json") ? manifest : emptyCollection;
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
  };
}

describe("LayerLegend", () => {
  it("wires hazard, scene toggle, and quick view controls to the map instance", async () => {
    const user = userEvent.setup();
    const map = createMapStub();

    render(<LayerLegend map={map as never} mode="3d" />);

    // Wait for the manifest to resolve and render the 5-yr radio.
    const floodButton = await screen.findByRole("button", {
      name: "Flood (5-yr)",
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

  it("updates viewport summary from the scene summary event payload", async () => {
    render(<LayerLegend map={createMapStub() as never} mode="3d" />);

    fireEvent(
      window,
      new CustomEvent("aeris:scene-summary", {
        detail: {
          buildingCount: 4,
          roadCount: 2,
          facilityCount: 5,
          facilitiesByCategory: { hospital: 1, evacuation: 1 },
          floodImpact: {
            buildings: { low: 0, medium: 0, high: 0 },
            roads: { low: 0, medium: 0, high: 0 },
          },
          generatedAt: "2026-04-24T00:00:00.000Z",
          attribution: "OpenStreetMap contributors / static scene pack",
        },
      }),
    );

    expect(await screen.findByText("Viewport context")).toBeInTheDocument();
    expect(screen.getByText("Buildings: 4")).toBeInTheDocument();
    expect(screen.getByText("Roads: 2")).toBeInTheDocument();
    expect(screen.getByText("Facilities: 5")).toBeInTheDocument();
    expect(screen.getByText(/Source: OpenStreetMap contributors/)).toBeInTheDocument();
  });

  it("shows a scene warning message when the 3D context pack fails", async () => {
    render(<LayerLegend map={createMapStub() as never} mode="3d" />);

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
    render(<LayerLegend map={createMapStub() as never} mode="2d" />);

    const toggle = screen.getByRole("button", { name: /Layers/ });
    expect(screen.getByText("Hazard")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText("Hazard")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("Hazard")).toBeInTheDocument();
  });
});
