import { expect, readJson, test } from "./fixtures";
import type { Page } from "@playwright/test";

const desk = (page: Page) => page.getByTestId("policy-desk");
const verdict = (page: Page) => page.getByTestId("verdict");
const tab = (page: Page, name: string) => desk(page).getByRole("tab", { name }).click();
const from = (page: Page, group: string, v: string) => desk(page).getByRole("group", { name: group }).getByRole("button", { name: v }).click();
const amount = (page: Page, id: string, v: number) => desk(page).locator(id).fill(String(v));

test.describe("policy", () => {
  test.beforeEach(async ({ page }) => page.goto("/policy"));

  test("[F34] the shared rule table runs and every case passes", async ({ page }) => {
    const n = readJson("bench", "policy-cases.json").cases.length;
    await expect(page.getByTestId("cases-summary")).toHaveText(`${n} OF ${n} PASS`);
    await expect(page.getByTestId("cases").locator("tbody tr")).toHaveCount(n);
    await page.getByRole("button", { name: "RUN AGAIN" }).click();
    await expect(page.getByTestId("cases-summary")).toHaveText(`${n} OF ${n} PASS`);
  });

  test("[F35] a value from outside is held, and owner values execute", async ({ page }) => {
    await expect(verdict(page)).toContainText("HELD");
    await expect(verdict(page)).toContainText("recipient from x.com/@attacker");
    await expect(verdict(page)).toContainText("amount from x.com/@attacker");
    await tab(page, "SOURCES");
    await from(page, "RECIPIENT CAME FROM", "OWNER");
    await expect(verdict(page)).not.toContainText("recipient from");
    await from(page, "AMOUNT CAME FROM", "OWNER");
    await expect(verdict(page)).toContainText("EXECUTED");
  });

  test("[F36] a remembered recipient passes inside its 1 NEAR cap and is held above it", async ({ page }) => {
    await tab(page, "WALLET");
    await desk(page).getByRole("switch", { name: /REMEMBERED/ }).click();
    await expect(verdict(page)).toContainText("amount from x.com/@attacker"); // 1.5 NEAR is over the cap
    await expect(verdict(page)).not.toContainText("recipient from");
    await tab(page, "ACTION");
    await amount(page, "#amt", 1);
    await expect(verdict(page)).toContainText("EXECUTED");
  });

  test("[F37] a pinned account's payee gets the 0.5 NEAR cooldown cap", async ({ page }) => {
    await tab(page, "WALLET");
    await desk(page).getByRole("switch", { name: /PINNED/ }).click();
    await tab(page, "ACTION");
    await amount(page, "#amt", 0.5);
    await expect(verdict(page)).toContainText("EXECUTED");
    await amount(page, "#amt", 0.6);
    await expect(verdict(page)).toContainText("HELD");
  });

  test("[F38] what was already spent counts against the 5 NEAR cap", async ({ page }) => {
    await tab(page, "SOURCES");
    await from(page, "RECIPIENT CAME FROM", "OWNER");
    await from(page, "AMOUNT CAME FROM", "OWNER");
    await expect(verdict(page)).toContainText("EXECUTED");
    await tab(page, "WALLET");
    await amount(page, "#spent", 4);
    await expect(verdict(page)).toContainText("REJECTED");
    await expect(verdict(page)).toContainText("global cap exceeded");
  });

  test("[F39] an outside swap token is always held", async ({ page }) => {
    await from(page, "KIND", "SWAP");
    await expect(verdict(page)).toContainText("token from x.com/@attacker");
    await tab(page, "WALLET");
    await desk(page).getByRole("switch", { name: /REMEMBERED/ }).click();
    await expect(verdict(page)).toContainText("token from x.com/@attacker");
  });

  test("[F40] attacker text is shown as text, never run as markup", async ({ page }) => {
    let fired = false;
    page.on("dialog", (d) => { fired = true; void d.dismiss(); });
    const evil = "<img src=x onerror=alert(1)>";
    await tab(page, "SOURCES");
    await desk(page).getByLabel("OUTSIDE SOURCE").fill(evil);
    await expect(verdict(page)).toContainText(`recipient from ${evil}`);
    await expect(verdict(page).locator("img")).toHaveCount(0);
    expect(fired).toBe(false);
  });

  test("[F65] an outside source that is merely named owner is still outside", async ({ page }) => {
    await tab(page, "SOURCES");
    await desk(page).getByLabel("OUTSIDE SOURCE").fill("owner");
    await expect(verdict(page)).toContainText("HELD");
    await expect(verdict(page)).toContainText("recipient from outside (named owner)");
  });

  test("[F41] an invalid recipient gets an explanation, not a verdict", async ({ page }) => {
    await desk(page).getByLabel("RECIPIENT").fill("NOT VALID!");
    await expect(verdict(page)).toContainText("recipient must be a NEAR account");
  });

  test("[F42] the desk changes nothing in the wallet", async ({ page, request }) => {
    const before = await (await request.get("/api/wallet")).json();
    await tab(page, "SOURCES");
    await from(page, "RECIPIENT CAME FROM", "OWNER");
    await from(page, "AMOUNT CAME FROM", "OWNER");
    await expect(verdict(page)).toContainText("EXECUTED");
    expect(await (await request.get("/api/wallet")).json()).toEqual(before);
  });
});
