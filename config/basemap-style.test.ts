import {
  CARTO_VECTOR_STYLE_URLS,
  getBasemapStyleUrl,
} from "./basemap-style";

describe("getBasemapStyleUrl", () => {
  it("maps light to Positron and dark to Dark Matter", () => {
    expect(getBasemapStyleUrl("light")).toBe(CARTO_VECTOR_STYLE_URLS.light);
    expect(getBasemapStyleUrl("dark")).toBe(CARTO_VECTOR_STYLE_URLS.dark);
    expect(getBasemapStyleUrl("light")).toContain("positron");
    expect(getBasemapStyleUrl("dark")).toContain("dark-matter");
  });
});
