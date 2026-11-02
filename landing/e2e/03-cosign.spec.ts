import { expect, newestProposal, pet, rob, test } from "./fixtures";

test.describe("co-sign", () => {
  test("[F17] a held payment shows the action, where it came from, and the MOCK note", async ({ page }) => {
    await rob(page, "F1");
    await page.goto("/cosign");
    const card = await newestProposal(page);
    await expect(card.getByRole("heading")).toHaveText("Send 1.5 NEAR to attacker.testnet");
    await expect(card.locator(".source")).toContainText("recipient <- x.com/@attacker");
    await expect(card).toContainText("no price feed configured");
    await expect(card).toContainText("no indexer configured");
    await expect(page.getByTestId("mode-note")).toContainText("MOCK");
  });

  test("[F18] approve once: it executes, leaves the list, and counts against the cap", async ({ page }) => {
    await page.goto("/wallet");
    const spentBefore = Number(await page.getByTestId("spent").innerText());
    await rob(page, "F1");
    await page.goto("/cosign");
    const card = await newestProposal(page);
    const testid = await card.getAttribute("data-testid");
    await card.getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(page.getByTestId(testid!).getByTestId("approved")).toContainText("Approved once");
    await expect(page.getByTestId(testid!).getByRole("button", { name: "APPROVE ONCE" })).toBeDisabled();
    await page.getByRole("button", { name: "REFRESH" }).click();
    await expect(page.getByTestId(testid!)).toHaveCount(0);
    await page.goto("/wallet");
    await expect(page.getByTestId("spent")).toHaveText(String(spentBefore + 1.5));
    await expect(page.getByTestId("book").or(page.getByTestId("book-empty"))).not.toContainText("attacker.testnet");
  });

  test("[F19] approve once leaves no trace: the same attack is held again", async ({ page }) => {
    await rob(page, "F1");
    await expect(pet(page, "taint")).toContainText("recipient from x.com/@attacker");
  });

  test("[F23] a lookalike of a known vendor is called out", async ({ page }) => {
    await rob(page, "F2");
    await page.goto("/cosign");
    const card = page.locator('[data-testid^="proposal-"]').filter({ hasText: "acrne.testnet" }).last();
    await expect(card.getByTestId("lookalike")).toHaveText("acrne.testnet vs acme.testnet: 2 characters differ");
  });

  test("[F24] a swap has no recipient to remember", async ({ page }) => {
    await rob(page, "F3");
    await page.goto("/cosign");
    const card = page.locator('[data-testid^="proposal-"]').filter({ hasText: "newtoken.testnet" }).last();
    await expect(card.getByRole("heading")).toContainText("Swap");
    await expect(card.getByRole("button", { name: /remember/i })).toHaveCount(0);
  });

  test("[F25] a second approval of the same proposal is refused", async ({ page, context }) => {
    await rob(page, "F2");
    await page.goto("/cosign");
    const stale = await context.newPage();
    await stale.goto("/cosign");
    const card = await newestProposal(page);
    const id = await card.getAttribute("data-testid");
    await card.getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(page.getByTestId(id!).getByTestId("approved")).toBeVisible();
    await stale.getByTestId(id!).getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(stale.getByTestId(id!).getByRole("alert")).toContainText("Refused: not pending");
    await stale.close();
  });

  test("[F26] an approval for a changed proposal is refused by the hash check", async ({ page }) => {
    await rob(page, "F1");
    await page.goto("/cosign");
    await page.route("**/api/cosign", async (route) => {
      const body = route.request().postDataJSON();
      await route.continue({ postData: JSON.stringify({ ...body, proposalHash: "tampered" }) });
    });
    const card = await newestProposal(page);
    await card.getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(card.getByRole("alert")).toContainText("Refused: hash mismatch");
    await expect(card.getByRole("button", { name: "APPROVE ONCE" })).toBeEnabled();
  });

  test("[F27] approve and remember adds the entry, and its 1 NEAR cap still binds", async ({ page }) => {
    await rob(page, "F1");
    await page.goto("/cosign");
    const card = await newestProposal(page);
    await card.getByRole("button", { name: /approve and remember/i }).click();
    await expect(card.getByTestId("approved")).toContainText("remembered");

    await page.goto("/wallet");
    const row = page.getByTestId("book").locator("tr").filter({ hasText: "attacker.testnet" });
    await expect(row).toContainText("1 NEAR");
    await expect(row).toContainText("x.com/@attacker");

    // Known now, but F1 asks for 1.5 NEAR: only the amount is still a reason to hold.
    await rob(page, "F1");
    await expect(pet(page, "taint").locator("[data-outcome]")).toHaveAttribute("data-outcome", "pending");
    await expect(pet(page, "taint")).toContainText("amount from x.com/@attacker");
    await expect(pet(page, "taint")).not.toContainText("recipient from");
  });

  test("[F28] an approval that would pass the 24 hour cap is refused", async ({ page, request }) => {
    const wallet = await (await request.get("/api/wallet")).json();
    const room = Number(wallet.globalCapNear) - Number(wallet.spent24hNear);
    expect(room).toBeGreaterThan(0);
    const pending = await (await request.get("/api/pending")).json();
    await page.goto("/cosign");
    // Approve held payments until one no longer fits.
    let left = room;
    for (const p of pending.filter((x: any) => x.action.recipient === "attacker.testnet")) {
      const card = page.getByTestId(`proposal-${p.proposalId}`);
      await card.getByRole("button", { name: "APPROVE ONCE" }).click();
      left -= Number(p.amountNear);
      if (left < 0) {
        await expect(card.getByRole("alert")).toContainText("Refused: global cap exceeded");
        return;
      }
      await expect(card.getByTestId("approved")).toBeVisible();
    }
    for (let i = 0; i < 6; i++) {
      await rob(page, "F1");
      await page.goto("/cosign");
      const card = await newestProposal(page);
      await card.getByRole("button", { name: "APPROVE ONCE" }).click();
      left -= 1.5;
      if (left < 0) {
        await expect(card.getByRole("alert")).toContainText("Refused: global cap exceeded");
        return;
      }
      await expect(card.getByTestId("approved")).toBeVisible();
    }
    throw new Error("never reached the cap");
  });
});
