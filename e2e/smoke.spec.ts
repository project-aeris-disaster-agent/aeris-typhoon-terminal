import { test, expect } from "@playwright/test";

test.describe("production smoke", () => {
  test("GET /api/health returns JSON with ok flag", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("aeris-typhoon-terminal");
    expect(typeof body.version).toBe("string");
    expect(body.ok).toBe(true);
    expect(body.checks.env).toBe("ok");
  });

  test("home page loads the map shell", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.ok()).toBe(true);
    await expect(page.locator(".maplibregl-canvas, canvas").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
