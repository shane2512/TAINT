import { describe, it, expect } from "vitest";
import { HandleStore } from "../src/handles";
import { buildProposal } from "../src/proposal";
import type { PlannedAction } from "../src/planner";

const none = null;

describe("buildProposal", () => {
  it("marks handle arguments Untrusted with their full source", () => {
    const s = new HandleStore();
    s.add("Account", "attacker.near", "x.com/@attacker");
    s.add("Amount", "3000000000000000000000000", "x.com/@attacker");
    const p: PlannedAction = { kind: "Transfer", recipient: { handle: "$h1" }, amount: { handle: "$h2" }, token: none };
    const r = buildProposal(p, s, "n1")!;
    expect(r.action).toEqual({ kind: "Transfer", recipient: "attacker.near", token: null, amount: "3000000000000000000000000" });
    expect(r.prov.recipient).toEqual({ class: "Untrusted", source: "x.com/@attacker" });
    expect(r.prov.amount).toEqual({ class: "Untrusted", source: "x.com/@attacker" });
    expect(r.prov.token).toBeNull();
  });

  it("marks literal arguments Owner and normalizes them", () => {
    const p: PlannedAction = { kind: "Transfer", recipient: { literal: "ALICE.near" }, amount: { literal: "0.5 NEAR" }, token: none };
    const r = buildProposal(p, new HandleStore(), "n1")!;
    expect(r.action.recipient).toBe("alice.near");
    expect(r.action.amount).toBe("500000000000000000000000");
    expect(r.prov.recipient).toEqual({ class: "Owner", source: "owner" });
    expect(r.prov.amount).toEqual({ class: "Owner", source: "owner" });
  });

  it("builds an owner-derived swap (the L2 shape)", () => {
    const p: PlannedAction = { kind: "Swap", recipient: none, token: { literal: "newtoken.testnet" }, amount: { literal: "20 NEAR" } };
    const r = buildProposal(p, new HandleStore(), "n1")!;
    expect(r.action).toEqual({ kind: "Swap", recipient: null, token: "newtoken.testnet", amount: "20000000000000000000000000" });
    expect(r.prov.token).toEqual({ class: "Owner", source: "owner" });
  });

  it("gives identical flowHash for identical input and nonce, and a new one for a new nonce", () => {
    const p: PlannedAction = { kind: "Transfer", recipient: { literal: "alice.near" }, amount: { literal: "1 NEAR" }, token: none };
    const a = buildProposal(p, new HandleStore(), "n1")!.flowHash;
    expect(buildProposal(p, new HandleStore(), "n1")!.flowHash).toBe(a);
    expect(buildProposal(p, new HandleStore(), "n2")!.flowHash).not.toBe(a);
  });

  it("makes one owner message map to one flowHash whatever the model plans, so a replay is caught even if the model is not deterministic", () => {
    const s = new HandleStore();
    s.add("Account", "alice.near", "x.com/@a");
    const viaHandle: PlannedAction = { kind: "Transfer", recipient: { handle: "$h1" }, amount: { literal: "1 NEAR" }, token: none };
    const viaLiteral: PlannedAction = { kind: "Transfer", recipient: { literal: "alice.near" }, amount: { literal: "2 NEAR" }, token: none };
    const a = buildProposal(viaHandle, s, "n")!.flowHash;
    expect(buildProposal(viaLiteral, new HandleStore(), "n")!.flowHash).toBe(a);
    expect(buildProposal(viaLiteral, new HandleStore(), "other")!.flowHash).not.toBe(a);
  });

  it("returns null for an unparseable literal amount", () => {
    const p: PlannedAction = { kind: "Transfer", recipient: { literal: "alice.near" }, amount: { literal: "max" }, token: none };
    expect(buildProposal(p, new HandleStore(), "n")).toBeNull();
  });

  it("returns null for an unparseable literal account", () => {
    const p: PlannedAction = { kind: "Transfer", recipient: { literal: "aliсe.near" }, amount: { literal: "1 NEAR" }, token: none };
    expect(buildProposal(p, new HandleStore(), "n")).toBeNull();
  });

  it("returns null for an unknown handle", () => {
    const p: PlannedAction = { kind: "Transfer", recipient: { handle: "$h9" }, amount: { literal: "1 NEAR" }, token: none };
    expect(buildProposal(p, new HandleStore(), "n")).toBeNull();
  });

  it("returns null when a handle has the wrong kind for its argument", () => {
    const s = new HandleStore();
    s.add("Account", "alice.near", "web");
    const p: PlannedAction = { kind: "Transfer", recipient: { literal: "bob.near" }, amount: { handle: "$h1" }, token: none };
    expect(buildProposal(p, s, "n")).toBeNull();
  });

  it("returns null for kind None and for malformed shapes", () => {
    expect(buildProposal({ kind: "None", recipient: none, token: none, amount: none }, new HandleStore(), "n")).toBeNull();
    const transferWithToken: PlannedAction = { kind: "Transfer", recipient: { literal: "a.near" }, token: { literal: "t.near" }, amount: { literal: "1 NEAR" } };
    expect(buildProposal(transferWithToken, new HandleStore(), "n")).toBeNull();
    const swapWithRecipient: PlannedAction = { kind: "Swap", recipient: { literal: "a.near" }, token: { literal: "t.near" }, amount: { literal: "1 NEAR" } };
    expect(buildProposal(swapWithRecipient, new HandleStore(), "n")).toBeNull();
  });
});
