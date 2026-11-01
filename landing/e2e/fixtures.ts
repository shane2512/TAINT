import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/** Any uncaught page error fails the test that caused it. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});
export { expect };

const root = path.resolve(process.cwd(), "..");
export const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(root, ...p), "utf8"));
export const readText = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
export const listDir = (...p: string[]) => fs.readdirSync(path.join(root, ...p)).sort();
export const fixture = (id: string) => readJson("bench", "fixtures", `${id}.json`);

export const preset = (page: Page, id: string) => page.getByTestId("presets").getByRole("button", { name: new RegExp(`^${id}\\b`) });
export const pet = (page: Page, agent: string) => page.getByTestId(`pet-${agent}`);

/** Runs a preset through the UI and waits for the three wallets to answer. */
export async function rob(page: Page, id: string): Promise<void> {
  if (!page.url().endsWith("/demo")) await page.goto("/demo");
  await preset(page, id).click();
  await expect(pet(page, "taint").locator("[data-outcome]")).toBeVisible();
}

/** The newest held proposal's card. */
export async function newestProposal(page: Page) {
  const cards = page.locator('[data-testid^="proposal-"]');
  await expect(cards.first()).toBeVisible();
  return cards.last();
}
