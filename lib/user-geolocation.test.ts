import { isWithinPhilippines } from "@/lib/user-geolocation";

describe("isWithinPhilippines", () => {
  it("accepts points inside the PH bbox", () => {
    expect(isWithinPhilippines(120.9842, 14.5995)).toBe(true);
    expect(isWithinPhilippines(123.8854, 10.3157)).toBe(true);
  });

  it("rejects points outside the PH bbox", () => {
    expect(isWithinPhilippines(139.7, 35.7)).toBe(false);
    expect(isWithinPhilippines(103.8, 1.3)).toBe(false);
  });
});
