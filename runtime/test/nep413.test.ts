import { randomBytes } from "node:crypto";
import { KeyPair } from "@near-js/crypto";
import { describe, expect, it } from "vitest";
import { NonceBook, SignedMessage, nep413Hash, verifyNep413 } from "../src/nep413";

const RECIPIENT = "taint-myname.testnet";

function sign(kp: KeyPair, message: string, over: Partial<SignedMessage> = {}): SignedMessage {
  const nonce = randomBytes(32);
  const { signature } = kp.sign(nep413Hash(message, nonce, RECIPIENT));
  return { accountId: "bob.testnet", publicKey: kp.getPublicKey().toString(), signature: Buffer.from(signature).toString("base64"), message, nonce: nonce.toString("base64"), recipient: RECIPIENT, ...over };
}
const opts = (kp: KeyPair, message: string, extra: Partial<Parameters<typeof verifyNep413>[1]> = {}) => ({
  recipient: RECIPIENT,
  expectMessage: message,
  keyCheck: async (a: string, k: string) => a === "bob.testnet" && k === kp.getPublicKey().toString(),
  nonces: new NonceBook(),
  ...extra,
});

describe("NEP-413 request authentication", () => {
  const kp = KeyPair.fromRandom("ed25519");
  it("hashes with the NEP-413 tag so a signature cannot be reused as a transaction", () => {
    const h = nep413Hash("hi", Buffer.alloc(32), "r");
    expect(h).toHaveLength(32);
    expect(h.equals(nep413Hash("hi", Buffer.alloc(32, 1), "r"))).toBe(false);
  });
  it("accepts a valid signature from a full-access key of the account", async () => {
    expect((await verifyNep413(sign(kp, "run F1"), opts(kp, "run F1"))).ok).toBe(true);
  });
  it("rejects a signature over a different message", async () => {
    const out = await verifyNep413(sign(kp, "run F1"), opts(kp, "run F3"));
    expect(out.ok).toBe(false);
  });
  it("rejects a tampered message even with a valid signature on the original", async () => {
    const m = sign(kp, "run F1");
    expect((await verifyNep413({ ...m, message: "run F3" }, opts(kp, "run F3"))).why).toBe("signature does not match");
  });
  it("rejects a signature made for another recipient", async () => {
    const nonce = randomBytes(32);
    const { signature } = kp.sign(nep413Hash("run F1", nonce, "evil.testnet"));
    const m = { ...sign(kp, "run F1"), signature: Buffer.from(signature).toString("base64"), nonce: nonce.toString("base64") };
    expect((await verifyNep413(m, opts(kp, "run F1"))).ok).toBe(false);
  });
  it("rejects a key that is not the account's full-access key", async () => {
    const other = KeyPair.fromRandom("ed25519");
    expect((await verifyNep413(sign(other, "run F1"), opts(kp, "run F1"))).why).toMatch(/full-access/);
  });
  it("rejects claiming someone else's account with your own valid key", async () => {
    const m = sign(kp, "run F1", { accountId: "victim.testnet" });
    expect((await verifyNep413(m, opts(kp, "run F1"))).ok).toBe(false);
  });
  it("rejects a replay of the same signed request", async () => {
    const m = sign(kp, "run F1");
    const o = opts(kp, "run F1");
    expect((await verifyNep413(m, o)).ok).toBe(true);
    expect((await verifyNep413(m, o)).why).toMatch(/already used/);
  });
  it("forgets nonces after the window", () => {
    let t = 0;
    const b = new NonceBook(1000, () => t);
    expect(b.take("n")).toBe(true);
    expect(b.take("n")).toBe(false);
    t = 2000;
    expect(b.take("n")).toBe(true);
  });
  it("rejects a wrong-length nonce", async () => {
    expect((await verifyNep413(sign(kp, "x", { nonce: Buffer.alloc(8).toString("base64") }), opts(kp, "x"))).why).toMatch(/32 bytes/);
  });
});
