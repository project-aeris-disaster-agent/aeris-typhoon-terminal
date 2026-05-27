import {
  parseKmhFromPagasaField,
  parsePagasaDailyHtml,
  stripTags,
} from "@/lib/pagasa-daily";

/**
 * A trimmed, structurally faithful fragment of the PAGASA Daily Weather page.
 * Keeps just enough markup to exercise every extractor.
 */
const FIXTURE_HTML = `
<html><body>
  <h3>Daily Weather</h3>
  <p><b>Issued at: 4:00 PM, 27 May 2026</b></p>
  <h4>Synopsis</h4>
  <p>Southwesterly Windflow affecting Palawan and the western section of Mindanao. Trough of Tropical Storm (TS) affecting the eastern section of Mindanao.</p>

  <h4>TC Information</h4>
  <table>
    <tr><td>TROPICAL CYCLONE OUTSIDE PAR AS OF 3:00 PM TODAY</td></tr>
    <tr><td>TROPICAL STORM JANGMI (2606)</td></tr>
    <tr><td>LOCATION: 1,260 KM EAST OF EASTERN VISAYAS (10.0&deg;N, 137.2&deg;E)</td></tr>
    <tr><td>MAXIMUM SUSTAINED WINDS: 65 KM/H NEAR THE CENTER</td></tr>
    <tr><td>GUSTINESS: UP TO 80 KM/H</td></tr>
    <tr><td>MOVEMENT: NORTHWESTWARD AT 20 KM/H</td></tr>
  </table>

  <h3>Forecast Weather Conditions</h3>
  <table>
    <tr><th>Place</th><th>Weather Condition</th><th>Caused By</th><th>Impacts</th></tr>
    <tr>
      <td>Zamboanga Peninsula, BARMM</td>
      <td>Cloudy skies with scattered rains and thunderstorms</td>
      <td>Southwesterly Windflow</td>
      <td>Possible flash floods or landslides due to moderate to at times heavy rains</td>
    </tr>
    <tr>
      <td>Davao Oriental and Davao Occidental</td>
      <td>Cloudy skies with scattered rains and thunderstorms</td>
      <td>Trough of TS</td>
      <td>Possible flash floods or landslides</td>
    </tr>
    <tr>
      <td>Metro Manila and the rest of the country</td>
      <td>Partly cloudy to cloudy skies with isolated rainshowers</td>
      <td>Localized Thunderstorms</td>
      <td>Possible flash floods during severe thunderstorms</td>
    </tr>
  </table>
</body></html>
`;

describe("parseKmhFromPagasaField", () => {
  it("extracts km/h from PAGASA wind lines", () => {
    expect(parseKmhFromPagasaField("65 KM/H NEAR THE CENTER")).toBe(65);
  });
});

describe("stripTags", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<p>Hello&nbsp;<b>World</b></p>")).toBe("Hello World");
  });

  it("decodes a few common entities", () => {
    expect(stripTags("A &amp; B &lt;c&gt;")).toBe("A & B <c>");
  });
});

describe("parsePagasaDailyHtml", () => {
  it("extracts the full structured payload from a representative fixture", () => {
    const parsed = parsePagasaDailyHtml(FIXTURE_HTML);
    expect(parsed).not.toBeNull();
    expect(parsed!.issuedAt).toBe("4:00 PM, 27 May 2026");
    expect(parsed!.synopsis).toContain("Southwesterly Windflow");

    expect(parsed!.tcOutsidePar).not.toBeNull();
    expect(parsed!.tcOutsidePar!.name).toContain("TROPICAL STORM JANGMI");
    expect(parsed!.tcOutsidePar!.location).toContain("EASTERN VISAYAS");
    expect(parsed!.tcOutsidePar!.maxWindsKmh).toContain("65 KM/H");
    expect(parsed!.tcOutsidePar!.gustinessKmh).toContain("80 KM/H");
    expect(parsed!.tcOutsidePar!.movement).toContain("NORTHWESTWARD");

    expect(parsed!.regionalConditions.length).toBeGreaterThanOrEqual(3);
    expect(parsed!.regionalConditions[0].place).toContain("Zamboanga");
    expect(parsed!.regionalConditions[0].causedBy).toContain("Southwesterly");
  });

  it("returns null when nothing extractable is present", () => {
    expect(parsePagasaDailyHtml("<html><body><p>nothing here</p></body></html>")).toBeNull();
  });

  it("survives missing TC block (no active TC)", () => {
    const html = FIXTURE_HTML.replace(/TC Information[\s\S]*?<\/table>/, "");
    const parsed = parsePagasaDailyHtml(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.tcOutsidePar).toBeNull();
    expect(parsed!.regionalConditions.length).toBeGreaterThan(0);
  });
});
