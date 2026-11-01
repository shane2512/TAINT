import { expect, test } from "./fixtures";

const PAGES = ["/demo", "/cosign", "/wallet", "/policy", "/redteam", "/results"];

test.describe("every app page", () => {
  for (const path of PAGES) {
    test(`[F49] ${path} shows the mode banner and marks itself in the nav`, async ({ page }) => {
      await page.goto(path);
      const banner = page.getByTestId("banner");
      await expect(banner).toContainText("mode=MOCK");
      await expect(banner).toContainText("network=none");
      await expect(banner).toContainText("ATTESTATION STUBBED");
      await expect(page.locator(`nav a[href="${path}"]`)).toHaveAttribute("aria-current", "page");
    });
  }

  test("[F50] the brand goes back to the landing page", async ({ page }) => {
    await page.goto("/wallet");
    await page.locator(".nav .brand").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#intro")).toBeVisible();
  });

  test("[F51] the keyboard can reach the controls, with a visible focus ring", async ({ page }) => {
    await page.goto("/demo");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).toBe("solid");
  });
});

test.describe("no runtime behind the site", () => {
  const OFF = "http://127.0.0.1:3111";

  test("[F52] the proxy answers 503 with the command to run", async ({ request }) => {
    const res = await request.get(`${OFF}/api/meta`);
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toContain("npm run web");
  });

  for (const path of PAGES) {
    test(`[F53] ${path} says the runtime is off, instead of breaking`, async ({ page }) => {
      await page.goto(OFF + path);
      await expect(page.getByTestId("banner")).toContainText("not running");
      await expect(page.locator(".error").first()).toContainText("npm run web");
    });
  }

  test("[F54] the landing page still reads, and the desk explains itself", async ({ page }) => {
    await page.goto(OFF + "/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("CHECK WHO");
    await expect(page.getByTestId("bench-rows")).toContainText("DRAINED");
    await page.getByTestId("policy-desk").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("verdict")).toContainText("not running");
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  for (const path of ["/", ...PAGES]) {
    test(`[F55] ${path} fits with no sideways scroll`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over).toBeLessThanOrEqual(0);
    });
  }

  test("[F56] the app can be used on a phone: rob, then approve", async ({ page }) => {
    await page.goto("/demo");
    await page.getByTestId("presets").getByRole("button", { name: /^F2\b/ }).click();
    await expect(page.getByTestId("pet-taint").locator("[data-outcome]")).toHaveAttribute("data-outcome", "pending");
    await page.locator('nav a[href="/cosign"]').click();
    await expect(page.locator('[data-testid^="proposal-"]').first()).toBeVisible();
  });
});
