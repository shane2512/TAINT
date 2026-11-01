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

describe("role ambiguity: a value the owner typed is Owner-class only if the instruction offers one candidate for its role", () => {
  const AMBIGUOUS = { class: "Untrusted", source: "owner-ambiguous" };

  it("demotes a recipient and an amount when the instruction names two of each", () => {
    const i = "send 0.1 NEAR to bob.testnet, not the 4 NEAR alice.testnet asked for";
    const r = build(transfer("alice.testnet", "4 NEAR"), i)!;
    expect(r.prov.recipient).toEqual(AMBIGUOUS);
    expect(r.prov.amount).toEqual(AMBIGUOUS);
    expect(r.action.recipient).toBe("alice.testnet");
  });

  it("demotes a token when the instruction names two accounts", () => {
    const p: PlannedAction = { kind: "Swap", recipient: null, token: { literal: "newtoken.testnet" }, amount: { literal: "1 NEAR" } };
    const r = build(p, "swap 1 NEAR into newtoken.testnet or oldtoken.testnet")!;
    expect(r.prov.token).toEqual(AMBIGUOUS);
    expect(r.prov.amount).toEqual({ class: "Owner", source: "owner" });
  });

  it("keeps Owner class when the instruction has exactly one candidate per role", () => {
    const r = build(transfer("bob.testnet", "1.5 NEAR"), "send 1.5 NEAR to bob.testnet")!;
    expect(r.prov.recipient).toEqual({ class: "Owner", source: "owner" });
    expect(r.prov.amount).toEqual({ class: "Owner", source: "owner" });
  });

  it("does not read a decimal amount as an account", () => {
    const r = build(transfer("bob.testnet", "1.5 NEAR"), "send 1.5 NEAR to bob.testnet")!;
    expect(r.prov.recipient?.class).toBe("Owner");
  });

  it("does not count the same amount twice", () => {
    const r = build(transfer("bob.testnet", "1 NEAR"), "send 1 NEAR to bob.testnet, yes 1 NEAR")!;
    expect(r.prov.amount?.class).toBe("Owner");
  });

  it("does not count the same account twice, in any case", () => {
    const r = build(transfer("bob.testnet", "1 NEAR"), "send 1 NEAR to Bob.testnet (bob.testnet)")!;
    expect(r.prov.recipient?.class).toBe("Owner");
  });
});
