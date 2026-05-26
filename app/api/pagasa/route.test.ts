/** @jest-environment node */
export {};

describe("/api/pagasa", () => {
  it("returns an empty alerts list (no machine-readable PAGASA feed)", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alerts: [] });
  });
});
