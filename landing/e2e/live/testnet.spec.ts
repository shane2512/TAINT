import { expect, test } from "@playwright/test";

// Opt-in, on the real testnet contract. The server proposed a held 0.001 NEAR transfer as it started.
test("[F58] testnet: a real held proposal is approved from the page, through the relayer", async ({ page, request }) => {
  await page.goto("/cosign");
  await expect(page.getByTestId("banner")).toContainText("network=testnet");
  await expect(page.getByTestId("banner")).toContainText("not a wallet");
  await expect(page.getByTestId("mode-note")).toContainText("demo owner key");

  const cards = page.locator('[data-testid^="proposal-"]');
  await expect(cards.first()).toBeVisible();
  const card = cards.last();
  const id = Number((await card.getAttribute("data-testid"))!.replace("proposal-", ""));
  await expect(card.locator(".source")).toContainText("x.com/@attacker");

  await card.getByRole("button", { name: "APPROVE ONCE" }).click();
  const link = card.getByTestId("explorer");
  await expect(link).toHaveAttribute("href", /^https:\/\/testnet\.nearblocks\.io\/txns\//);
  console.log("transaction:", await link.getAttribute("href"));

  // The chain, not the page, says it is no longer held.
  await expect(async () => {
    const pending = await (await request.get("/api/pending")).json();
    expect(pending.map((p: { proposalId: number }) => p.proposalId)).not.toContain(id);
  }).toPass({ timeout: 60_000, intervals: [3000] });
});

test("[F59] testnet: the wallet reads from the chain and offers no writes", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByTestId("readonly")).toContainText("testnet");
  await expect(page.getByRole("button", { name: "REMEMBER" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PIN", exact: true })).toHaveCount(0);
});

test("[F60] testnet: the simulated demo and mock suites are off", async ({ page, request }) => {
  await page.goto("/demo");
  await expect(page.locator(".error")).toContainText("connected to testnet");
  expect((await request.post("/api/redteam", { data: {} })).status()).toBe(409);
  expect((await request.post("/api/attack", { data: { preset: "F1" } })).status()).toBe(404);
});
