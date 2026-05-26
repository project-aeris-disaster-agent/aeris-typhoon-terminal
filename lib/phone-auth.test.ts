import { isValidPhoneE164, normalizePhoneE164 } from "@/lib/phone-auth";

describe("phone-auth", () => {
  it("normalizes PH 09xx to +639xx", () => {
    expect(normalizePhoneE164("09171234567")).toBe("+639171234567");
  });

  it("normalizes 9xx without leading zero", () => {
    expect(normalizePhoneE164("9171234567")).toBe("+639171234567");
  });

  it("keeps valid +63 numbers", () => {
    expect(normalizePhoneE164("+639611521492")).toBe("+639611521492");
  });

  it("validates e164", () => {
    expect(isValidPhoneE164("+639171234567")).toBe(true);
    expect(isValidPhoneE164("0917")).toBe(false);
  });
});
