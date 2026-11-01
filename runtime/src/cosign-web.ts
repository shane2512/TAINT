// The co-sign page against a real network. `npm run cosign-web -- --propose` first has the worker propose a held
// 0.001 NEAR transfer from an "attacker" source, so there is something to approve. The owner key is a demo key read
// from .env and held by this local server: this is not wallet signing.
import fs from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { buildCosignDelegate, encodeForRelay } from "./cosign";
import { NearContractClient } from "./near";
import { makeSender, relay } from "./relayer";
import { createAppServer } from "./server";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see docs/SETUP-ACCOUNTS.md)`);
  return v;
};

async function main(): Promise<void> {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const network = (process.env.NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
  if (network === "mainnet") throw new Error("cosign-web is testnet-only: it signs with a key held by this process");
  const contractId = need("TAINT_CONTRACT");
  const ownerId = need("OWNER_ACCOUNT");
  const client = new NearContractClient({ network, contractId, workerAccount: need("WORKER_ACCOUNT"), workerSecretKey: need("WORKER_PRIVATE_KEY") });
  const owner = new Account(ownerId, new JsonRpcProvider({ url: "https://rpc.testnet.near.org" }), KeyPairSigner.fromSecretKey(need("OWNER_PRIVATE_KEY") as `ed25519:${string}`));
  const send = makeSender({ network, contractId, owner: ownerId, relayerAccount: need("RELAYER_ACCOUNT"), relayerSecretKey: need("RELAYER_PRIVATE_KEY") });

  if (process.argv.includes("--propose")) {
    const src = { class: "Untrusted" as const, source: "x.com/@attacker" };
    const { outcome } = await client.propose(
      { kind: "Transfer", recipient: ownerId, token: null, amount: (10n ** 21n).toString() },
      { recipient: src, token: null, amount: src },
      "web-" + Date.now(),
    );
    console.log("proposed:", JSON.stringify(outcome));
  }

  const server = createAppServer({
    chain: {
      network,
      getPending: () => client.getPending(),
      getBook: () => client.getBook(),
      cosign: async (id, hash, remember) =>
        relay(encodeForRelay(await buildCosignDelegate(owner, contractId, id, hash, remember)), { contractId, owner: ownerId, send }),
    },
  });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, "127.0.0.1", () => console.log(`[taint] network=${network} co-sign page: http://127.0.0.1:${port}/cosign`));
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
