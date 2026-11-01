import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createAppServer, type ChainCosign } from "../src/server";

const pending = {
  proposalId: 9,
  proposalHash: "h9",
  action: { kind: "Transfer" as const, recipient: "attacker.testnet", token: null, amount: "1000000000000000000000" },
  prov: { recipient: { class: "Untrusted" as const, source: "x.com/@attacker" }, token: null, amount: { class: "Untrusted" as const, source: "x.com/@attacker" } },
  flowHash: "f",
  createdAt: 1,
};

let server: Server;
let base: string;
let calls: unknown[][];
let result: { txHash: string; failure?: string };

beforeEach(async () => {
  process.env.MOCK = "1";
  calls = [];
  result = { txHash: "TX1" };
  const chain: ChainCosign = {
    network: "testnet",
    getPending: async () => [pending],
    getBook: async () => [],
    cosign: async (...a) => (calls.push(a), result),
  };
  server = createAppServer({ chain });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  delete process.env.MOCK;
  await new Promise((r) => server.close(r));
});

const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("chain-backed co-sign server", () => {
  it("lists what the chain is holding, with its provenance line", async () => {
    const items = await (await fetch(base + "/pending")).json();
    expect(items).toHaveLength(1);
    expect(items[0].proposalId).toBe(9);
    expect(items[0].sourceLine).toMatch(/x\.com\/@attacker/);
  });

  it("approves through the chain and returns the transaction hash", async () => {
    const res = await post("/cosign", { proposalId: 9, proposalHash: "h9", remember: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: "TX1", explorer: "https://testnet.nearblocks.io/txns/TX1" });
    expect(calls).toEqual([[9, "h9", true]]);
  });

  it("reports a failed delegate as a refusal, not a success", async () => {
    result = { txHash: "TX2", failure: '{"DelegateActionInvalidNonce":{}}' };
    const res = await post("/cosign", { proposalId: 9, proposalHash: "h9" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/DelegateActionInvalidNonce/);
  });

  it("says which network the page is on, and that the owner key is a demo key", async () => {
    const meta = await (await fetch(base + "/meta")).json();
    expect(meta.banner).toContain("network=testnet");
    expect(meta.banner).toMatch(/demo owner key/);
    expect(meta.banner).not.toContain("network=none");
  });

  it("serves no attack endpoint in chain mode", async () => {
    expect((await post("/attack", { preset: "F1" })).status).toBe(404);
  });
});
