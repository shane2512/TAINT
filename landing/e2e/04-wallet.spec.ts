import { expect, test } from "./fixtures";

test.describe("wallet", () => {
  test.beforeEach(async ({ page }) => page.goto("/wallet"));
  const book = (page: any) => page.getByRole("region", { name: "Address book" });
  const pins = (page: any) => page.getByRole("region", { name: "Pinned accounts" });

  test("[F29] remember an account with a cap, see it, forget it", async ({ page }) => {
    await book(page).getByLabel("ACCOUNT").fill("vendor-e2e.testnet");
    await book(page).getByLabel("CAP (NEAR)").fill("0.5");
    await book(page).getByRole("button", { name: "REMEMBER" }).click();
    const row = page.getByTestId("book").locator("tr").filter({ hasText: "vendor-e2e.testnet" });
    await expect(row).toContainText("0.5 NEAR");
    await expect(row).toContainText("owner");
    await expect(book(page).getByLabel("ACCOUNT")).toHaveValue("");
    await page.reload();
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "Forget vendor-e2e.testnet" }).click();
    await expect(row).toHaveCount(0);
  });

  test("[F30] pin and unpin an account", async ({ page }) => {
    await pins(page).getByLabel("ACCOUNT").fill("pinned-e2e.testnet");
    await pins(page).getByRole("button", { name: "PIN", exact: true }).click();
    await expect(page.getByTestId("pins")).toContainText("pinned-e2e.testnet");
    await page.getByRole("button", { name: "Unpin pinned-e2e.testnet" }).click();
    await expect(page.getByText("pinned-e2e.testnet")).toHaveCount(0);
  });

  test("[F31] a bad account or cap is refused with a reason, and changes nothing", async ({ page }) => {
    await book(page).getByLabel("ACCOUNT").fill("<img src=x onerror=alert(1)>");
    await book(page).getByRole("button", { name: "REMEMBER" }).click();
    await expect(page.locator(".error")).toContainText("not a NEAR account");
    await expect(book(page).getByLabel("ACCOUNT")).toHaveValue("<img src=x onerror=alert(1)>");
    await book(page).getByLabel("ACCOUNT").fill("fine.testnet");
    await book(page).getByLabel("CAP (NEAR)").fill("lots");
    await book(page).getByRole("button", { name: "REMEMBER" }).click();
    await expect(page.locator(".error")).toContainText("cap must be a NEAR amount");
    await expect(page.getByText("fine.testnet", { exact: true })).toHaveCount(0);
  });

  test("[F32] the vendor pinned by the L1 preset shows up here", async ({ page }) => {
    await page.goto("/demo");
    await page.getByTestId("presets").getByRole("button", { name: /^L1\b/ }).click();
    await expect(page.getByTestId("pet-taint").locator("[data-outcome]")).toBeVisible();
    await page.goto("/wallet");
    await expect(page.getByTestId("pins")).toContainText("acme");
  });

  test("[F33] the owner calls that only exist on the contract are listed, not faked", async ({ page }) => {
    const owner = page.getByRole("region", { name: "Owner calls" });
    for (const c of ["set_paused", "remove_worker", "withdraw", "set_config"]) await expect(owner).toContainText(c);
    await expect(owner.getByRole("button")).toHaveCount(0);
  });
});
