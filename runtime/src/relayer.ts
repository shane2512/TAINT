// Pays gas for the owner's signed cosign delegates. It is not trusted: the chain verifies the owner's signature, key
// nonce and expiry. It still refuses anything that is not one `cosign` call to the TAINT contract from the owner,
// so it cannot be used as a free gas pump for other calls.
import http from "node:http";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { SignedDelegate, actionCreators } from "@near-js/transactions";
import { decodeSignedDelegate } from "./cosign";

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** `failure` is set when the transaction landed but the delegate action itself failed (for example a reused nonce). */
export interface Sent {
  txHash: string;
  failure?: string;
}

export interface RelayDeps {
  contractId: string;
  /** The only account whose delegates are relayed. */
  owner: string;
  send: (sd: SignedDelegate) => Promise<Sent>;
}

export async function relay(b64: string, deps: RelayDeps): Promise<Sent> {
  let sd: SignedDelegate;
  try {
    sd = decodeSignedDelegate(b64);
  } catch {
    throw new RelayError(400, "not a signed delegate");
  }
  const d = sd.delegateAction;
  if (d.receiverId !== deps.contractId) throw new RelayError(400, "receiver not allowed");
  if (d.senderId !== deps.owner) throw new RelayError(400, "sender not allowed");
  if (d.actions.length !== 1) throw new RelayError(400, "exactly one action allowed");
  const fc = (d.actions[0] as { functionCall?: { methodName: string; deposit: bigint } }).functionCall;
  if (!fc || fc.methodName !== "cosign" || fc.deposit !== 0n) throw new RelayError(400, "method not allowed");
  return deps.send(sd);
}

export interface RelayerOptions {
  network: "testnet" | "mainnet";
  contractId: string;
  owner: string;
  relayerAccount: string;
  relayerSecretKey: string;
  rpcUrl?: string;
}

const RPC = { testnet: "https://rpc.testnet.near.org", mainnet: "https://rpc.mainnet.near.org" } as const;

/** Sends the delegate in a transaction signed by the relayer account. Returns the transaction hash. */
export function makeSender(o: RelayerOptions): RelayDeps["send"] {
  const account = new Account(o.relayerAccount, new JsonRpcProvider({ url: o.rpcUrl ?? RPC[o.network] }), KeyPairSigner.fromSecretKey(o.relayerSecretKey as `ed25519:${string}`));
  return async (sd) => {
    const res = await account.signAndSendTransaction({ receiverId: sd.delegateAction.senderId, actions: [actionCreators.signedDelegate(sd)], throwOnFailure: false });
    const failures = [res.status, ...(res.receipts_outcome ?? []).map((r: any) => r.outcome.status)]
      .map((st: any) => st?.Failure)
      .filter(Boolean);
    return { txHash: res.transaction.hash as string, ...(failures.length ? { failure: JSON.stringify(failures[0]) } : {}) };
  };
}

/** POST /relay {signedDelegate: base64} -> {txHash}. Binds to localhost only. */
export function startRelayer(o: RelayerOptions, port = 3030): http.Server {
  const deps: RelayDeps = { contractId: o.contractId, owner: o.owner, send: makeSender(o) };
  const server = http.createServer((req, res) => {
    const reply = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/relay") return reply(404, { error: "not found" });
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 8192) req.destroy();
    });
    req.on("end", async () => {
      try {
        reply(200, await relay(JSON.parse(raw).signedDelegate, deps));
      } catch (e) {
        reply(e instanceof RelayError ? e.status : 500, { error: (e as Error).message });
      }
    });
  });
  return server.listen(port, "127.0.0.1");
}
