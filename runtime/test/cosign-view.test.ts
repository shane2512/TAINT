import { describe, it, expect } from "vitest";
import { describePending, formatNear, levenshtein, nearestEntry } from "../src/cosign-view";
import { provenanceLine } from "../src/provenance";
import type { PendingProposal } from "../src/mock-contract";

describe("formatNear", () => {
  it.each([
    ["1500000000000000000000000", "1.5"],
    ["1000000000000000000000000", "1"],
    ["1", "0.000000000000000000000001"],
    ["0", "0"],
    ["400000000000000000000000", "0.4"],
  ])("formats %s as %s", (yocto, near) => {
    expect(formatNear(yocto)).toBe(near);
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("nearestEntry", () => {
  it("finds a lookalike of a known counterparty", () => {
    expect(nearestEntry("acrne.testnet", ["bob.testnet", "acme.testnet"])).toEqual({ entry: "acme.testnet", distance: 2 });
  });
  it("returns the address itself at distance 0 when it is known", () => {
    expect(nearestEntry("acme.testnet", ["acme.testnet"])).toEqual({ entry: "acme.testnet", distance: 0 });
  });
  it("returns null for an address unlike anything known", () => {
    expect(nearestEntry("attacker.testnet", ["acme.testnet"])).toBeNull();
  });
  it("returns null when nothing is known", () => {
    expect(nearestEntry("acme.testnet", [])).toBeNull();
  });
});

describe("provenanceLine", () => {
  it("lists only the untrusted arguments with their source", () => {
    expect(
      provenanceLine({
        recipient: { class: "Untrusted", source: "x.com/@attacker" },
        token: null,
        amount: { class: "Owner", source: "owner" },
      }),
    ).toBe("recipient <- x.com/@attacker");
  });
  it("is empty when everything came from the owner", () => {
    expect(provenanceLine({ recipient: null, token: null, amount: { class: "Owner", source: "owner" } })).toBe("");
  });
});

describe("describePending", () => {
  const pending = (recipient: string): PendingProposal => ({
    proposalId: 3,
    proposalHash: "h",
    flowHash: "f",
    createdAt: 0,
    action: { kind: "Transfer", recipient, token: null, amount: "1500000000000000000000000" },
    prov: {
      recipient: { class: "Untrusted", source: "email:billing@acrne.testnet" },
      token: null,
      amount: { class: "Untrusted", source: "email:billing@acrne.testnet" },
    },
  });

  it("shows the source line, the amount and a diff against the lookalike it resembles", () => {
    const v = describePending(pending("acrne.testnet"), ["acme.testnet"]);
    expect(v.sourceLine).toBe("recipient <- email:billing@acrne.testnet; amount <- email:billing@acrne.testnet");
    expect(v.amountNear).toBe("1.5");
    expect(v.amountUsd).toBeNull();
    expect(v.nearestBookEntry).toBe("acme.testnet");
    expect(v.diff).toBe("acrne.testnet vs acme.testnet: 2 characters differ");
    expect(v.accountCreated).toBe("unknown");
    expect(v.proposalId).toBe(3);
  });

  it("has no diff for an address unlike any known counterparty", () => {
    const v = describePending(pending("attacker.testnet"), ["acme.testnet"]);
    expect(v.nearestBookEntry).toBeNull();
    expect(v.diff).toBeNull();
  });

  it("says so when the address is exactly a known counterparty", () => {
    const v = describePending(pending("acme.testnet"), ["acme.testnet"]);
    expect(v.nearestBookEntry).toBe("acme.testnet");
    expect(v.diff).toBe("same as known counterparty acme.testnet");
  });
});
