import { describe, it, expect } from "vitest";
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import { buildCosignDelegate, decodeSignedDelegate, encodeForRelay } from "../src/cosign";
import { RelayError, relay } from "../src/relayer";

const CONTRACT = "taint.testnet";
const kp = KeyPair.fromRandom("ed25519");

// An owner whose chain reads are stubbed: block height 1000, access-key nonce 41.
function owner(): Account {
  const provider = { viewBlock: async () => ({ header: { height: 1000 } }) } as any;
  const acct = new Account("owner.testnet", provider, new KeyPairSigner(kp));
  (acct as any).getAccessKey = async () => ({ nonce: 41 });
  return acct;
}

describe("buildCosignDelegate", () => {
  it("signs one cosign call to the contract, valid for a bounded number of blocks", async () => {
    const sd = await buildCosignDelegate(owner(), CONTRACT, 7, "hash-abc", true);
    const d = sd.delegateAction;
    expect(d.senderId).toBe("owner.testnet");
    expect(d.receiverId).toBe(CONTRACT);
    expect(d.maxBlockHeight).toBe(1120n);
    expect(d.nonce).toBe(42n);
    expect(d.actions).toHaveLength(1);
    const fc = (d.actions[0] as any).functionCall;
    expect(fc.methodName).toBe("cosign");
    expect(JSON.parse(Buffer.from(fc.args).toString())).toEqual({ proposal_id: 7, proposal_hash: "hash-abc", remember: true });
    expect(fc.deposit).toBe(0n);
  });

  it("survives encoding for the relayer and decoding back", async () => {
    const sd = await buildCosignDelegate(owner(), CONTRACT, 1, "h", false, 50);
    const back = decodeSignedDelegate(encodeForRelay(sd));
    expect(back.delegateAction.maxBlockHeight).toBe(1050n);
    expect(back.delegateAction.senderId).toBe("owner.testnet");
  });
});

describe("relay", () => {
  const sent: unknown[] = [];
  const deps = (contractId = CONTRACT) => ({ contractId, owner: "owner.testnet", send: async (sd: unknown) => (sent.push(sd), { txHash: "txhash123" }) });

  it("forwards a valid cosign delegate and returns the transaction hash", async () => {
    const b64 = encodeForRelay(await buildCosignDelegate(owner(), CONTRACT, 1, "h", false));
    expect(await relay(b64, deps())).toEqual({ txHash: "txhash123" });
    expect(sent).toHaveLength(1);
  });

  it("refuses a delegate aimed at another contract: 400 receiver not allowed", async () => {
    const b64 = encodeForRelay(await buildCosignDelegate(owner(), "evil.testnet", 1, "h", false));
    await expect(relay(b64, deps())).rejects.toMatchObject({ status: 400, message: "receiver not allowed" });
  });

  it("refuses any method other than cosign", async () => {
    const a = owner();
    const [, sd] = await a.createSignedMetaTransaction(CONTRACT, [actionCreators.functionCall("withdraw", {}, 1n, 0n)]);
    await expect(relay(encodeForRelay(sd), deps())).rejects.toMatchObject({ status: 400, message: "method not allowed" });
  });

  it("refuses a delegate carrying more than one action", async () => {
    const a = owner();
    const call = actionCreators.functionCall("cosign", { proposal_id: 1, proposal_hash: "h", remember: false }, 1n, 0n);
    const [, sd] = await a.createSignedMetaTransaction(CONTRACT, [call, call]);
    await expect(relay(encodeForRelay(sd), deps())).rejects.toMatchObject({ status: 400, message: "exactly one action allowed" });
  });

  it("refuses a delegate signed by someone other than the owner", async () => {
    const stranger = new Account("stranger.testnet", { viewBlock: async () => ({ header: { height: 1 } }) } as any, new KeyPairSigner(kp));
    (stranger as any).getAccessKey = async () => ({ nonce: 1 });
    const b64 = encodeForRelay(await buildCosignDelegate(stranger, CONTRACT, 1, "h", false));
    await expect(relay(b64, deps())).rejects.toMatchObject({ status: 400, message: "sender not allowed" });
  });

  it("refuses garbage", async () => {
    await expect(relay("not-a-delegate", deps())).rejects.toBeInstanceOf(RelayError);
  });
});
