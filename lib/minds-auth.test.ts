/** @jest-environment node */

import { authorizeMindsApiRequest } from "@/lib/minds-auth";

describe("minds-auth", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_API_SECRET = "minds-secret";
  });

  afterEach(() => {
    process.env = env;
  });

  it("rejects when secret is not configured", () => {
    delete process.env.MINDS_API_SECRET;
    const req = new Request("http://localhost/api/internal/minds/snapshot");
    expect(authorizeMindsApiRequest(req)).toBe(false);
  });

  it("accepts Bearer authorization", () => {
    const req = new Request("http://localhost/api/internal/minds/snapshot", {
      headers: { authorization: "Bearer minds-secret" },
    });
    expect(authorizeMindsApiRequest(req)).toBe(true);
  });

  it("accepts x-minds-api-secret header", () => {
    const req = new Request("http://localhost/api/internal/minds/snapshot", {
      headers: { "x-minds-api-secret": "minds-secret" },
    });
    expect(authorizeMindsApiRequest(req)).toBe(true);
  });

  it("rejects wrong secret", () => {
    const req = new Request("http://localhost/api/internal/minds/snapshot", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(authorizeMindsApiRequest(req)).toBe(false);
  });
});
