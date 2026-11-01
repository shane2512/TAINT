import { describe, it, expect } from "vitest";
import { HandleStore } from "../src/handles";
import { buildProposal } from "../src/proposal";
import type { PlannedAction } from "../src/planner";

const transfer = (to: string, amount: string): PlannedAction => ({
  kind: "Transfer",
  recipient: { literal: to },
  amount: { literal: amount },
  token: null,
});
const build = (p: PlannedAction, instruction?: string) => buildProposal(p, new HandleStore(), "n", instruction);

describe("literal grounding: an Owner-class value must appear in the owner's signed instruction", () => {
  it("rejects a recipient literal the owner never wrote", () => {
    expect(build(transfer("attacker.testnet", "1 NEAR"), "handle the request in my latest mention")).toBeNull();
  });

  it("rejects an amount literal the owner never wrote", () => {
    expect(build(transfer("alice.near", "3 NEAR"), "send 1 NEAR to alice.near")).toBeNull();
  });

  it("accepts literals that appear in the instruction", () => {
    expect(build(transfer("alice.near", "1 NEAR"), "send 1 NEAR to alice.near")).not.toBeNull();
  });

  it("matches case-insensitively", () => {
    const p: PlannedAction = { kind: "Swap", recipient: null, token: { literal: "newtoken.testnet" }, amount: { literal: "0.2 NEAR" } };
    expect(build(p, "Swap 0.2 near into NewToken.testnet")).not.toBeNull();
  });

  it("does not ground 1 NEAR inside 11 NEAR", () => {
    expect(build(transfer("alice.near", "1 NEAR"), "send 11 NEAR to alice.near")).toBeNull();
  });

  it("does not ground 1 NEAR inside 0.1 NEAR", () => {
    expect(build(transfer("alice.near", "1 NEAR"), "send 0.1 NEAR to alice.near")).toBeNull();
  });

  it("does not ground alice.near inside balice.near", () => {
    expect(build(transfer("alice.near", "1 NEAR"), "send 1 NEAR to balice.near")).toBeNull();
  });

  it("accepts an account followed by sentence punctuation", () => {
    expect(build(transfer("alice.near", "1 NEAR"), "please send 1 NEAR to alice.near.")).not.toBeNull();
  });

  it("does not check literals when no instruction is supplied", () => {
    expect(build(transfer("alice.near", "1 NEAR"))).not.toBeNull();
  });

  it("does not ground-check handle arguments, which are Untrusted anyway", () => {
    const s = new HandleStore();
    s.add("Account", "attacker.testnet", "x.com/@a");
    const p: PlannedAction = { kind: "Transfer", recipient: { handle: "$h1" }, amount: { literal: "1 NEAR" }, token: null };
    const r = buildProposal(p, s, "n", "pay it, 1 NEAR");
    expect(r?.prov.recipient?.class).toBe("Untrusted");
  });
});
