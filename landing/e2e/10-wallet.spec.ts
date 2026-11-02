import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const OWNER = "owner-e2e.testnet";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

type Behaviour = "ok" | "rejected" | "refuses";

/** Stands in for the wallet. The page was built to use window.__tainttest when NEXT_PUBLIC_WALLET_MOCK=1. */
async function fakeWallet(page: Page, account: string | null, behaviour: Behaviour = "ok") {
  await page.addInitScript(
    ({ account, behaviour, executed, rejected }) => {
      const listeners: (() => void)[] = [];
      const w = {
        acct: account as string | null,
        calls: [] as unknown[],
        accountId() { return this.acct; },
        connect() { this.calls.push({ connect: true }); },
        async disconnect() { this.acct = null; listeners.forEach((f) => f()); },
        async cosign(info: { contractId: string }, p: { proposalId: number; proposalHash: string }, remember: boolean) {
          this.calls.push({ receiverId: info.contractId, method: "cosign", proposal_id: p.proposalId, proposal_hash: p.proposalHash, remember });
          if (behaviour === "refuses") throw new Error("User rejected the transaction");
          return behaviour === "ok" ? executed : rejected;
        },
        onChange(f: () => void) { listeners.push(f); return () => {}; },
      };
      (window as unknown as { __tainttest: unknown }).__tainttest = w;
    },
    {
      account,
      behaviour,
      executed: { status: { SuccessValue: "" }, transaction: { hash: "TXOK" }, receipts_outcome: [{ outcome: { status: { SuccessValue: b64({ Executed: { proposal_id: 7 } }) } } }] },
      rejected: { status: { SuccessValue: "" }, transaction: { hash: "TXREJ" }, receipts_outcome: [{ outcome: { status: { SuccessValue: b64({ Rejected: { reason: "global cap exceeded" } }) } } }] },
    },
  );
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __tainttest: { calls: unknown[] } }).__tainttest.calls);

async function open(page: Page, url = "/cosign") {
  await page.goto(url);
  await page.getByTestId("wallet-toggle").click();
  await expect(page.getByTestId("wallet-cosign")).toBeVisible();
}
const card = (page: Page) => page.getByTestId("chain-proposal-7");

test.describe("approve on testnet with your own wallet", () => {
  test("[F66] the real contract's held payments show their source and a lookalike warning", async ({ page }) => {
    await fakeWallet(page, null);
    await open(page);
    await expect(card(page).getByRole("heading")).toHaveText("SEND 0.4 NEAR TO acrne.testnet");
    await expect(card(page).locator(".source")).toContainText("email:billing@acrne.testnet");
    await expect(card(page)).toContainText("acrne.testnet vs acme.testnet: 2 characters differ");
    await expect(page.getByTestId("wallet-cosign")).toContainText("taint-e2e.testnet");
    await expect(page.getByTestId("wallet-cosign")).toContainText("No key is held by this site");
  });

  test("[F67] with no wallet connected nothing can be approved, and Connect asks the wallet", async ({ page }) => {
    await fakeWallet(page, null);
    await open(page);
    await expect(card(page).getByRole("button", { name: "APPROVE ONCE" })).toBeDisabled();
    await page.getByTestId("wallet-connect").click();
    expect(await calls(page)).toEqual([{ connect: true }]);
  });

  test("[F68] a wallet that is not the owner account is told so and cannot approve", async ({ page }) => {
    await fakeWallet(page, "stranger.testnet");
    await open(page);
    await expect(page.locator(".error").filter({ hasText: "Only" })).toContainText(`Only ${OWNER} can approve`);
    await expect(card(page).getByRole("button", { name: "APPROVE ONCE" })).toBeDisabled();
    await expect(card(page).getByRole("button", { name: /APPROVE AND REMEMBER/ })).toBeDisabled();
  });

  test("[F69] the owner's wallet is asked to sign one cosign call for exactly that proposal", async ({ page }) => {
    await fakeWallet(page, OWNER);
    await open(page);
    await expect(page.getByTestId("wallet-account")).toContainText(OWNER);
    await card(page).getByRole("button", { name: "APPROVE ONCE" }).click();
    expect(await calls(page)).toEqual([{ receiverId: "taint-e2e.testnet", method: "cosign", proposal_id: 7, proposal_hash: "hash7", remember: false }]);
    await expect(card(page).getByTestId("chain-approved")).toContainText("Approved on chain");
    await expect(card(page).getByTestId("chain-explorer")).toHaveAttribute("href", "https://testnet.nearblocks.io/txns/TXOK");
    await expect(card(page).getByRole("button", { name: "APPROVE ONCE" })).toBeDisabled();
  });

  test("[F70] approve and remember asks the contract to remember", async ({ page }) => {
    await fakeWallet(page, OWNER);
    await open(page);
    await card(page).getByRole("button", { name: /APPROVE AND REMEMBER/ }).click();
    expect(await calls(page)).toEqual([{ receiverId: "taint-e2e.testnet", method: "cosign", proposal_id: 7, proposal_hash: "hash7", remember: true }]);
  });

  test("[F71] a refusal the contract returns as an ordinary value is shown as a refusal, not an approval", async ({ page }) => {
    await fakeWallet(page, OWNER, "rejected");
    await open(page);
    await card(page).getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(card(page).locator(".error")).toContainText("contract refused: global cap exceeded");
    await expect(card(page).getByTestId("chain-approved")).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: "APPROVE ONCE" })).toBeEnabled();
  });

  test("[F72] a wallet the owner declines in leaves the proposal untouched", async ({ page }) => {
    await fakeWallet(page, OWNER, "refuses");
    await open(page);
    await card(page).getByRole("button", { name: "APPROVE ONCE" }).click();
    await expect(card(page).locator(".error")).toContainText("the wallet did not sign: User rejected the transaction");
    await expect(card(page).getByRole("button", { name: "APPROVE ONCE" })).toBeEnabled();
  });

  test("[F73] coming back from a wallet that signs elsewhere reports what the chain did", async ({ page }) => {
    await fakeWallet(page, OWNER);
    await open(page, "/cosign?transactionHashes=TXOK");
    await expect(page.getByTestId("wallet-back")).toContainText("Approved on chain");
    await expect(page.getByTestId("wallet-back").getByRole("link")).toHaveAttribute("href", /txns\/TXOK$/);
    expect(new URL(page.url()).search).toBe("");
  });

  test("[F74] coming back after a refusal says the contract refused it", async ({ page }) => {
    await fakeWallet(page, OWNER);
    await open(page, "/cosign?transactionHashes=TXREJ");
    await expect(page.locator(".error").filter({ hasText: "refused" })).toContainText("contract refused: global cap exceeded");
    await expect(page.getByTestId("wallet-back")).toHaveCount(0);
  });

  test("[F75] a server with no testnet contract configured says so", async ({ page }) => {
    await fakeWallet(page, null);
    await page.goto("http://127.0.0.1:3112/cosign");
    await page.getByTestId("wallet-toggle").click();
    await expect(page.getByTestId("wallet-off")).toContainText("no testnet contract configured");
  });
});
