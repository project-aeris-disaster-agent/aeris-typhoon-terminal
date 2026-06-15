/** @jest-environment node */
export {};

import { safePostLoginPath } from "./safe-redirect";

describe("safePostLoginPath", () => {
  it("defaults empty values to dashboard home", () => {
    expect(safePostLoginPath(null)).toBe("/");
    expect(safePostLoginPath(undefined)).toBe("/");
    expect(safePostLoginPath("")).toBe("/");
  });

  it("maps legacy /chat links to dashboard home", () => {
    expect(safePostLoginPath("/chat")).toBe("/");
  });

  it("rejects unknown page paths that would 404", () => {
    expect(safePostLoginPath("/does-not-exist")).toBe("/");
  });

  it("blocks auth loop targets", () => {
    expect(safePostLoginPath("/login")).toBe("/");
    expect(safePostLoginPath("/refresh")).toBe("/");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safePostLoginPath("//evil.example")).toBe("/");
    expect(safePostLoginPath("https://evil.example")).toBe("/");
  });
});
