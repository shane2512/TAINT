import { describe, it, expect } from "vitest";
import { KeyPair } from "@near-js/crypto";
import { signOwnerMessage, verifyOwnerMessage } from "../src/owner";

const kp = KeyPair.fromRandom("ed25519");
const owner = kp.getPublicKey().toString();

describe("owner messages", () => {
  it("rejects an instruction over 280 characters", () => {
    expect(() => signOwnerMessage("x".repeat(281), [], kp)).toThrow(/instruction over 280 chars/);
  });
  it("accepts exactly 280 characters", () => {
    expect(() => signOwnerMessage("x".repeat(280), [], kp)).not.toThrow();
  });
  it("round-trips a signature", () => {
    const m = signOwnerMessage("pay acme", [{ source: "email", text: "pay 1 NEAR" }], kp);
    expect(verifyOwnerMessage(m, owner)).toBe(true);
  });
  it("fails verification when an attachment is tampered with", () => {
    const m = signOwnerMessage("pay acme", [{ source: "email", text: "pay 1 NEAR" }], kp);
    m.attachments[0].text = "pay 1000 NEAR";
    expect(verifyOwnerMessage(m, owner)).toBe(false);
  });
  it("fails verification when the instruction is tampered with", () => {
    const m = signOwnerMessage("pay acme", [], kp);
    m.instruction = "pay mallory";
    expect(verifyOwnerMessage(m, owner)).toBe(false);
  });
  it("fails verification against a different owner key", () => {
    const m = signOwnerMessage("pay acme", [], kp);
    expect(verifyOwnerMessage(m, KeyPair.fromRandom("ed25519").getPublicKey().toString())).toBe(false);
  });
  it("gives each message a fresh nonce", () => {
    expect(signOwnerMessage("a", [], kp).nonce).not.toBe(signOwnerMessage("a", [], kp).nonce);
  });
});
