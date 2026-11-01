import { expect, test } from "./fixtures";

// Runs first, on a runtime nothing has touched yet.
test.describe("first run, before anything has happened", () => {
  test("[F20] the co-sign page says nothing is waiting and points at the demo", async ({ page }) => {
    await page.goto("/cosign");
    await expect(page.getByTestId("empty")).toContainText("Nothing is waiting for you");
    await page.getByTestId("empty").getByRole("link").click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("[F21] the wallet starts empty, at 0 of the 5 NEAR cap", async ({ page }) => {
    await page.goto("/wallet");
    await expect(page.getByTestId("book-empty")).toBeVisible();
    await expect(page.getByTestId("pins-empty")).toBeVisible();
    await expect(page.getByTestId("meter")).toContainText("0 / 5 NEAR");
  });

  test("[F22] the attack log starts empty and every wallet is waiting", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByText("No attacks yet")).toBeVisible();
    for (const a of ["naive", "allowlist", "taint"]) await expect(page.getByTestId(`pet-${a}`)).toContainText("WAITING");
  });
});
