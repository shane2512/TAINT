import { describe, it, expect } from "vitest";
import { MockContract, defaultMockConfig } from "../src/mock-contract";

const DAY = 24 * 60 * 60 * 1000;

describe("knownCounterparties", () => {
  it("lists live address-book entries and payees registered by pinned accounts", () => {
    let t = 0;
    const c = new MockContract(defaultMockConfig(() => t));
    c.remember("friend.testnet");
    c.pin("acme.testnet");
    c.registerPayee("acme.testnet", "acme-pay.testnet");
    expect(c.knownCounterparties().sort()).toEqual(["acme-pay.testnet", "friend.testnet"]);
  });

  it("leaves out payees registered by accounts that are not pinned", () => {
    const c = new MockContract(defaultMockConfig());
    c.registerPayee("stranger.testnet", "evil.testnet");
    expect(c.knownCounterparties()).toEqual([]);
  });

  it("leaves out an expired address-book entry", () => {
    let t = 0;
    const c = new MockContract(defaultMockConfig(() => t));
    c.remember("friend.testnet", undefined, 1000);
    t += DAY;
    expect(c.knownCounterparties()).toEqual([]);
  });
});
