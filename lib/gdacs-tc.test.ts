/** @jest-environment node */
export {};

import {
  categoryFromGdacsProps,
  isInParBbox,
  parseWindKphFromSeverityText,
  windKphFromGdacsProps,
  windKphFromRssSeverity,
} from "./gdacs-tc";

describe("gdacs-tc", () => {
  it("parses wind from severitytext when severity value disagrees", () => {
    expect(
      parseWindKphFromSeverityText(
        "Tropical Storm (maximum wind speed of 93 km/h)",
      ),
    ).toBe(93);
  });

  it("reads current GDACS severitydata shape", () => {
    const props = {
      severitydata: {
        severity: 166.6656,
        severitytext:
          "Tropical Depression (maximum wind speed of 167 km/h)",
        severityunit: "km/h",
      },
      alertlevel: "Green",
    };
    expect(windKphFromGdacsProps(props)).toBe(167);
    expect(categoryFromGdacsProps(props, 167)).toBe("Tropical Depression");
  });

  it("supports legacy wind_speed fields", () => {
    expect(windKphFromGdacsProps({ wind_speed: 85 })).toBe(85);
  });

  it("prefers RSS severity text over the value attribute", () => {
    expect(
      windKphFromRssSeverity(
        "287.0352",
        "Tropical Storm (maximum wind speed of 93 km/h)",
      ),
    ).toBe(93);
  });

  it("filters PAR bbox consistently with alerts", () => {
    expect(isInParBbox(125.6, 14.2)).toBe(true);
    expect(isInParBbox(156.1, 28.7)).toBe(false);
    expect(isInParBbox(137.5, 9.6)).toBe(false);
  });
});
