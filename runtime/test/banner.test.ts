import { describe, it, expect, afterEach } from "vitest";
import { attestationStubbed, banner } from "../src/banner";

afterEach(() => {
  delete process.env.ATTESTATION;
  delete process.env.MOCK;
});

describe("banner", () => {
  it("flags a stubbed attestation by default", () => {
    expect(attestationStubbed()).toBe(true);
    expect(banner("testnet")).toContain("ATTESTATION STUBBED");
  });
  it("omits the flag when attestation is real", () => {
    process.env.ATTESTATION = "real";
    expect(attestationStubbed()).toBe(false);
    expect(banner("testnet")).not.toContain("ATTESTATION STUBBED");
  });
  it("always states the network and the mode", () => {
    process.env.ATTESTATION = "real";
    process.env.MOCK = "1";
    expect(banner("mainnet")).toBe("[taint] network=mainnet mode=MOCK");
  });
});
