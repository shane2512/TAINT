import { randomBytes } from "node:crypto";
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { expect, test } from "../fixtures";
import { nep413Hash } from "../../../runtime/src/nep413";

// Opt-in, on the real testnet contract with a real model (Groq only: NEAR AI credits are not used). The wallet is the
// only thing stood in for: a Node-side signer holding the relayer account's key plays the visitor's wallet, because a
// browser test cannot drive MyNearWallet's own page. Everything else is the real site, runtime, contract and model.
const CONTRACT = process.env.TAINT_CONTRACT ?? "taint-myname.testnet";
const VISITOR = process.env.RELAYER_ACCOUNT ?? "relayer-myname.testnet";
const key = process.env.RELAYER_PRIVATE_KEY as `ed25519:${string}`;
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const account = () => new Account(VISITOR, provider, KeyPairSigner.fromSecretKey(key));

test.beforeEach(async ({ page }) => {
  const kp = KeyPair.fromString(key);
  await page.exposeFunction("__sign", (message: string, recipient: string) => {
    const nonce = randomBytes(32);
    const { signature } = kp.sign(nep413Hash(message, nonce, recipient));
    return { accountId: VISITOR, publicKey: kp.getPublicKey().toString(), signature: Buffer.from(signature).toString("base64"), message, nonce: nonce.toString("base64"), recipient };
  });
  await page.exposeFunction("__call", async (method: string, args: object, deposit: string) => {
    const out = await account().callFunctionRaw({ contractId: CONTRACT, methodName: method, args, gas: 100_000_000_000_000n, deposit: BigInt(deposit) });
    return JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
  await page.addInitScript((visitor) => {
    let on = false;
    const subs = new Set<() => void>();
    const w = window as unknown as { __tainttest: unknown; __sign: (m: string, r: string) => Promise<unknown>; __call: (m: string, a: object, d: string) => Promise<unknown> };
    w.__tainttest = {
      accountId: () => (on ? visitor : null),
      connect: () => { on = true; subs.forEach((f) => f()); },
      disconnect: async () => { on = false; subs.forEach((f) => f()); },
      signMessage: (m: string, r: string) => w.__sign(m, r),
      call: (m: string, a: object, d: bigint) => w.__call(m, a, d.toString()),
      onChange: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
    };
  }, VISITOR);
});

test("[L1] a visitor connects, opens an account, authorises the agent, is attacked and the attack is held on the real contract", async ({ page, request }) => {
  const view = async () => (await (await request.get(`/api/live/account?owner=${VISITOR}`)).json()) as { exists: boolean; held: { proposalId: number }[]; balanceNear: string };

  await page.goto("/demo");
  await expect(page.getByTestId("banner")).toContainText("mode=LIVE");
  await expect(page.getByTestId("gate-connect")).toBeVisible();
  await page.getByTestId("wallet-connect").click();

  const before = await view();
  if (!before.exists) {
    await expect(page.getByTestId("gate-open")).toBeVisible();
    await page.getByTestId("deposit-amount").fill("1");
    await page.getByTestId("open-account").click();
  }
  const authorise = page.getByTestId("authorise");
  if (await authorise.isVisible({ timeout: 60_000 }).catch(() => false)) await authorise.click();

  await expect(page.getByTestId("presets")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("presets").getByRole("button", { name: /^F1\b/ }).click();
  await expect(page.getByTestId("pet-taint").locator("[data-outcome]")).toBeVisible({ timeout: 150_000 });
  const outcome = await page.getByTestId("pet-taint").locator("[data-outcome]").getAttribute("data-outcome");
  console.log("taint outcome on the real model:", outcome);
  expect(["pending", "none"]).toContain(outcome); // held, or the model declined: never executed
  if (outcome === "pending") {
    await expect(page.getByTestId("tx-link")).toBeVisible();
    await expect(page.getByTestId("pet-taint")).toContainText("x.com/@attacker");
    // the attack is on the chain, held, in this visitor's account: it was not paid
    await expect(async () => expect((await view()).held.length).toBeGreaterThan(0)).toPass({ timeout: 60_000, intervals: [3000] });
  }
});

test("[L1b] a held payment on the real contract is approved with the visitor's own wallet and pays out", async ({ page, request }) => {
  // The worker proposes a small payment from an outside source, the way the agent does; the contract holds it.
  const worker = new Account(process.env.WORKER_ACCOUNT!, provider, KeyPairSigner.fromSecretKey(process.env.WORKER_PRIVATE_KEY as `ed25519:${string}`));
  const own = { class: "Owner", source: "owner" };
  const out = await worker.callFunctionRaw({
    contractId: CONTRACT,
    methodName: "propose",
    args: { owner: VISITOR, action: { kind: "Transfer", recipient: "worker-myname.testnet", token: null, amount: "10000000000000000000000" }, prov: { recipient: { class: "Untrusted", source: "x.com/@e2e" }, token: null, amount: own }, flow_hash: "e2e-" + randomBytes(8).toString("hex") },
    gas: 100_000_000_000_000n,
    deposit: 0n,
  });
  const value = JSON.parse(Buffer.from((out.status as { SuccessValue: string }).SuccessValue, "base64").toString());
  expect(value.Pending).toBeTruthy();
  const id = value.Pending.proposal_id as number;

  await page.goto("/cosign");
  await page.getByTestId("wallet-connect").click();
  const card = page.getByTestId(`chain-proposal-${id}`);
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card.locator(".source")).toContainText("x.com/@e2e");
  await card.getByRole("button", { name: "Approve once" }).click();
  await expect(card.getByTestId("chain-explorer")).toHaveAttribute("href", /nearblocks\.io\/txns\//, { timeout: 120_000 });
  await expect(async () => {
    const held = ((await (await request.get(`/api/live/account?owner=${VISITOR}`)).json()) as { held: { proposalId: number }[] }).held;
    expect(held.map((h) => h.proposalId)).not.toContain(id);
  }).toPass({ timeout: 60_000, intervals: [3000] });
});

test("[L2] the account page shows the balance from the contract and lets the owner change it with the wallet", async ({ page }) => {
  await page.goto("/wallet");
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("balance")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("call-ok")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("pause")).toHaveText("Resume the agent", { timeout: 60_000 });
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("pause")).toHaveText("Pause everything", { timeout: 120_000 });
});

test("[L3] without a wallet nothing runs and nothing simulated is offered", async ({ page, request }) => {
  await page.goto("/demo");
  await expect(page.getByTestId("gate-connect")).toBeVisible();
  await expect(page.getByTestId("presets")).toHaveCount(0);
  expect((await request.post("/api/attack", { data: { preset: "F1" } })).status()).toBe(404);
  expect((await request.post("/api/live/prepare", { data: { owner: "nobody-here-1234.testnet", preset: "F1" } })).status()).toBe(409);
});
