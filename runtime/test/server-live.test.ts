import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { KeyPair } from "@near-js/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/agents/allowlist";
import { loadFixtures } from "../../bench/replay";
import { MockContract, defaultMockConfig } from "../src/mock-contract";
import { MockContractClient } from "../src/near";
import { nep413Hash } from "../src/nep413";
import { createAppServer } from "../src/server";

const CONTRACT = "taint-myname.testnet";
const WORKER = "worker-myname.testnet";
const bob = KeyPair.fromRandom("ed25519");

let server: Server;
let base: string;
/** One contract per owner, standing in for the chain; the live path itself is the code under test. */
let chains: Map<string, MockContract>;
let accounts: Map<string, { workers: string[] }>;

const fixtures = loadFixtures();
const presets = fixtures.map((f) => ({ id: f.id, title: f.title, kind: f.kind, instruction: f.instruction, attachments: f.attachments }));

async function start(limits: object = {}) {
  chains = new Map();
  accounts = new Map([["bob.testnet", { workers: [WORKER] }]]);
  const view = {
    getAccount: async (o: string) => {
      const a = accounts.get(o);
      return a ? { balance: "2000000000000000000000000", paused: false, workers: a.workers, config: { remember_cap: "1", remember_ttl_ns: "1", payee_cooldown_ns: "1", payee_cooldown_cap: "1", global_cap_24h: "5000000000000000000000000" } } : null;
    },
    getPending: async (o: string) => (chains.get(o)?.getPending() ?? []),
    getBook: async (o: string) => (chains.get(o)?.getBook() ?? []),
    getPins: async (o: string) => chains.get(o)?.getPins() ?? [],
    getSpent24h: async () => "0",
  };
  server = createAppServer({
    live: {
      network: "testnet",
      contractId: CONTRACT,
      workerAccount: WORKER,
      view,
      clientFor: (owner) => {
        const c = chains.get(owner) ?? new MockContract(defaultMockConfig());
        chains.set(owner, c);
        return new MockContractClient(c);
      },
      keyCheck: async (a, k) => a === "bob.testnet" && k === bob.getPublicKey().toString(),
      presets,
      allowlist: loadConfig("baselines/allowlist.json"),
      limits,
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(() => {
  process.env.MOCK = "1"; // the model: recorded answers, so the test needs no key and no network
});
afterEach(async () => {
  delete process.env.MOCK;
  await new Promise((r) => server.close(r));
});

const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function signed(owner: string, message: string, kp = bob, over: object = {}) {
  const nonce = randomBytes(32);
  const { signature } = kp.sign(nep413Hash(message, nonce, CONTRACT));
  return { accountId: owner, publicKey: kp.getPublicKey().toString(), signature: Buffer.from(signature).toString("base64"), message, nonce: nonce.toString("base64"), recipient: CONTRACT, ...over };
}

describe("the live path", () => {
  it("describes itself and lists the presets", async () => {
    await start();
    const info = await (await fetch(base + "/live/info")).json();
    expect(info.contractId).toBe(CONTRACT);
    expect(info.presets.map((p: any) => p.id)).toContain("F1");
  });

  it("reads an account straight from the contract, and says when there is none", async () => {
    await start();
    expect((await (await fetch(base + "/live/account?owner=nobody.testnet")).json()).exists).toBe(false);
    const a = await (await fetch(base + "/live/account?owner=bob.testnet")).json();
    expect(a).toMatchObject({ exists: true, workerAuthorised: true, balanceNear: "2" });
  });

  it("refuses to prepare a run for an owner with no account or no authorised agent", async () => {
    await start();
    expect((await post("/live/prepare", { owner: "nobody.testnet", preset: "F1" })).status).toBe(409);
    accounts.set("eve.testnet", { workers: [] });
    const r = await post("/live/prepare", { owner: "eve.testnet", preset: "F1" });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("no-worker");
  });

  it("runs the attack: the owner's wallet signs, the worker proposes for that owner, and the attack is held", async () => {
    await start();
    const prep = await (await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).json();
    const res = await post("/live/run", { id: prep.id, auth: signed("bob.testnet", prep.message) });
    expect(res.status).toBe(200);
    const out = await res.json();
    const taint = out.results.find((r: any) => r.agent === "taint");
    expect(taint.outcome).toBe("pending");
    expect(taint.path).toMatch(/x\.com/);
    expect(chains.get("bob.testnet")!.getPending()).toHaveLength(1);
    expect(chains.has("alice.testnet")).toBe(false);
  });

  it("refuses a signature from a key that is not the account's", async () => {
    await start();
    const prep = await (await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).json();
    const res = await post("/live/run", { id: prep.id, auth: signed("bob.testnet", prep.message, KeyPair.fromRandom("ed25519")) });
    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it("refuses a signature over a different message, and one signed by another account", async () => {
    await start();
    const prep = await (await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).json();
    expect((await post("/live/run", { id: prep.id, auth: signed("bob.testnet", "TAINT run something else") })).status).toBe(403);
    expect((await post("/live/run", { id: prep.id, auth: signed("mallory.testnet", prep.message) })).status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it("cannot be replayed: a signed run works once", async () => {
    await start();
    const prep = await (await post("/live/prepare", { owner: "bob.testnet", preset: "L1" })).json();
    const auth = signed("bob.testnet", prep.message);
    expect((await post("/live/run", { id: prep.id, auth })).status).toBe(200);
    expect((await post("/live/run", { id: prep.id, auth })).status).toBe(404);
  });

  it("rate limits runs per account", async () => {
    await start({ perOwnerPerHour: 2 });
    expect((await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).status).toBe(200);
    expect((await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).status).toBe(200);
    const third = await post("/live/prepare", { owner: "bob.testnet", preset: "F1" });
    expect(third.status).toBe(429);
  });

  it("has a daily budget for the whole site", async () => {
    await start({ perDay: 1, perOwnerPerHour: 10, perIpPerHour: 10 });
    expect((await post("/live/prepare", { owner: "bob.testnet", preset: "F1" })).status).toBe(200);
    const next = await post("/live/prepare", { owner: "bob.testnet", preset: "F1" });
    expect(next.status).toBe(429);
    expect((await next.json()).error).toMatch(/daily/);
  });

  it("turns off everything that is simulated on the other routes", async () => {
    await start();
    expect((await post("/attack", { preset: "F1" })).status).toBe(404);
    expect((await post("/wallet/remember", { address: "a.testnet" })).status).toBe(404);
    expect((await fetch(base + "/pending")).status).toBe(404);
  });

  it("says in /meta that it is the live path", async () => {
    await start();
    const meta = await (await fetch(base + "/meta")).json();
    expect(meta.live).toBe(true);
    expect(meta.banner).toMatch(/mode=LIVE/);
  });
});
