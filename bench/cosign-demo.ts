// End to end on a real network: a tainted transfer is held, the owner approves it with one signed delegate action
// that a relayer submits, and the same signed delegate is then replayed and rejected.
// Run: NEAR_NETWORK=testnet npm run cosign-demo   (needs the .env accounts; spends 0.001 NEAR of the contract's balance)
import fs from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { buildCosignDelegate, encodeForRelay } from "../runtime/src/cosign";
import { NearContractClient } from "../runtime/src/near";
import { makeSender, relay } from "../runtime/src/relayer";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see docs/SETUP-ACCOUNTS.md)`);
  return v;
};

async function main(): Promise<void> {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const network = (process.env.NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
  const link = (h: string) => `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${h}`;
  const contractId = need("TAINT_CONTRACT");
  const ownerId = need("OWNER_ACCOUNT");
  console.log(`[taint] network=${network} cosign-demo (real chain, real gas)`);

  const worker = new NearContractClient({ network, contractId, workerAccount: need("WORKER_ACCOUNT"), workerSecretKey: need("WORKER_PRIVATE_KEY"), owner: need("OWNER_ACCOUNT") });
  const amount = (10n ** 21n).toString(); // 0.001 NEAR
  const flowHash = "demo-" + Date.now();

  const { outcome, txHash } = await worker.propose(
    { kind: "Transfer", recipient: ownerId, token: null, amount },
    { recipient: { class: "Untrusted", source: "x.com/@attacker" }, token: null, amount: { class: "Untrusted", source: "x.com/@attacker" } },
    flowHash,
  );
  if (!("Pending" in outcome)) throw new Error("expected the tainted transfer to be held, got " + JSON.stringify(outcome));
  const { proposal_id, proposal_hash, reasons } = outcome.Pending;
  console.log(`1. HELD  proposal ${proposal_id}: ${reasons.join("; ")}\n   ${link(txHash)}`);

  const provider = new JsonRpcProvider({ url: network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org" });
  const owner = new Account(ownerId, provider, KeyPairSigner.fromSecretKey(need("OWNER_PRIVATE_KEY") as `ed25519:${string}`));
  const signed = await buildCosignDelegate(owner, contractId, proposal_id, proposal_hash, false);
  const b64 = encodeForRelay(signed);
  console.log(`2. owner signed one delegate action (valid until block ${signed.delegateAction.maxBlockHeight}); the owner sends no transaction and pays no gas`);

  const deps = {
    contractId,
    owner: ownerId,
    send: makeSender({ network, contractId, owner: ownerId, relayerAccount: need("RELAYER_ACCOUNT"), relayerSecretKey: need("RELAYER_PRIVATE_KEY") }),
  };
  const first = await relay(b64, deps);
  const stillPending = (await worker.getPending()).some((p) => p.proposalId === proposal_id);
  console.log(`3. relayed: ${first.failure ? "FAILED " + first.failure : stillPending ? "still pending (cap?)" : "EXECUTED, no longer pending"}\n   ${link(first.txHash)}`);

  const second = await relay(b64, deps);
  console.log(`4. the SAME signed delegate again: ${second.failure ? "REJECTED " + second.failure : "ACCEPTED (unexpected)"}\n   ${link(second.txHash)}`);
  if (first.failure || stillPending || !second.failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
