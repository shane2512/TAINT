// Has the worker propose one held 0.001 NEAR transfer on testnet, from an "attacker" source, so there is something
// to approve with your wallet. It spends nothing until you approve; it expires after 15 minutes.
// Run: npm run propose-testnet   (needs the .env accounts; the worker pays gas)
import fs from "node:fs";
import { NearContractClient } from "../runtime/src/near";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see docs/SETUP-ACCOUNTS.md)`);
  return v;
};

async function main(): Promise<void> {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const network = (process.env.NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
  if (network === "mainnet") throw new Error("propose-testnet is testnet-only");
  const client = new NearContractClient({ network, contractId: need("TAINT_CONTRACT"), workerAccount: need("WORKER_ACCOUNT"), workerSecretKey: need("WORKER_PRIVATE_KEY") });
  const src = { class: "Untrusted" as const, source: "x.com/@attacker" };
  const { outcome, txHash } = await client.propose(
    { kind: "Transfer", recipient: need("OWNER_ACCOUNT"), token: null, amount: (10n ** 21n).toString() },
    { recipient: src, token: null, amount: src },
    "wallet-" + Date.now(),
  );
  if (!("Pending" in outcome)) throw new Error("expected the transfer to be held, got " + JSON.stringify(outcome));
  console.log(`held: proposal ${outcome.Pending.proposal_id} (${outcome.Pending.reasons.join("; ")}). Approve it within 15 minutes.`);
  console.log(`https://testnet.nearblocks.io/txns/${txHash}`);
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
