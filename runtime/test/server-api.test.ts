import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createAppServer, type ChainCosign } from "../src/server";

let server: Server;
let base: string;

const listen = async (s: Server) => {
  server = s;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const evaluate = async (body: object) => (await post("/policy/evaluate", body)).json();

beforeEach(async () => {
  process.env.MOCK = "1";
  await listen(createAppServer());
});
afterEach(async () => {
  delete process.env.MOCK;
  await new Promise((r) => server.close(r));
});

describe("GET /meta", () => {
  it("says which network and mode the server is in, and gives each preset's text", async () => {
    const meta = await (await fetch(base + "/meta")).json();
    expect(meta.network).toBe("none");
    expect(meta.mode).toBe("MOCK");
    const f1 = meta.presets.find((p: any) => p.id === "F1");
    expect(f1.instruction).toMatch(/latest mention/);
    expect(f1.attachments[0].source).toBe("x.com/@attacker");
  });
});

describe("POST /policy/evaluate", () => {
  const transfer = { kind: "Transfer", recipient: "bob.testnet", amountNear: "1", recipientSource: "owner", amountSource: "owner" };

  it("executes owner-class values", async () => {
    const r = await evaluate(transfer);
    expect(r.decision).toBe("executed");
  });

  it("holds an untrusted recipient and names its source", async () => {
    const r = await evaluate({ ...transfer, recipientSource: "x.com/@attacker" });
    expect(r.decision).toBe("held");
    expect(r.reasons).toEqual(["recipient from x.com/@attacker"]);
  });

  it("lets a remembered recipient through inside its 1 NEAR cap, and holds above it", async () => {
    const r = { ...transfer, recipientSource: "mail", amountSource: "mail", remembered: true };
    expect((await evaluate(r)).decision).toBe("executed");
    expect((await evaluate({ ...r, amountNear: "1.5" })).reasons).toEqual(["amount from mail"]);
  });

  it("uses the 0.5 NEAR cooldown cap for a payee registered by a pinned account", async () => {
    const r = { ...transfer, recipientSource: "mail", amountSource: "mail", pinnedPayee: true };
    expect((await evaluate({ ...r, amountNear: "0.4" })).decision).toBe("executed");
    expect((await evaluate({ ...r, amountNear: "0.6" })).decision).toBe("held");
  });

  it("rejects what would pass the 24h cap, counting what was already spent", async () => {
    const r = await evaluate({ ...transfer, amountNear: "2", spentNear: "4" });
    expect(r.decision).toBe("rejected");
    expect(r.reasons).toEqual(["global cap exceeded"]);
  });

  it("evaluates a swap's token", async () => {
    const r = await evaluate({ kind: "Swap", token: "new.testnet", amountNear: "1", tokenSource: "listing", amountSource: "owner" });
    expect(r.reasons).toEqual(["token from listing"]);
  });

  it("refuses bad input with a 400", async () => {
    expect((await post("/policy/evaluate", { ...transfer, amountNear: "lots" })).status).toBe(400);
    expect((await post("/policy/evaluate", { ...transfer, kind: "Burn" })).status).toBe(400);
    expect((await post("/policy/evaluate", { ...transfer, recipient: "NOT VALID" })).status).toBe(400);
  });

  it("refuses an already-spent amount above the cap instead of quietly ignoring it", async () => {
    const r = await post("/policy/evaluate", { ...transfer, spentNear: "100" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/spentNear/);
    expect((await post("/policy/evaluate", { ...transfer, spentNear: "5" })).status).toBe(200);
  });

  it("does not leak state between calls", async () => {
    expect((await evaluate({ ...transfer, amountNear: "5" })).decision).toBe("executed");
    expect((await evaluate({ ...transfer, amountNear: "5" })).decision).toBe("executed");
  });
});

describe("GET /policy/cases", () => {
  it("runs the shared rule table against the mock contract and every case passes", async () => {
    const cases = await (await fetch(base + "/policy/cases")).json();
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((c: any) => !c.pass)).toEqual([]);
    expect(cases[0].steps).toBeGreaterThan(0);
  });
});

describe("wallet", () => {
  const wallet = async () => (await fetch(base + "/wallet")).json();

  it("starts empty, with the 5 NEAR cap", async () => {
    expect(await wallet()).toMatchObject({ network: "none", writable: true, book: [], pins: [], spent24hNear: "0", globalCapNear: "5" });
  });

  it("remembers and forgets an address, with a cap", async () => {
    expect((await post("/wallet/remember", { address: "bob.testnet", capNear: "0.5" })).status).toBe(200);
    const [e] = (await wallet()).book;
    expect(e).toMatchObject({ address: "bob.testnet", capNear: "0.5", learnedFrom: "owner" });
    expect(e.expiresAt).toBeGreaterThan(Date.now());
    await post("/wallet/forget", { address: "bob.testnet" });
    expect((await wallet()).book).toEqual([]);
  });

  it("uses the default 1 NEAR cap when none is given", async () => {
    await post("/wallet/remember", { address: "bob.testnet" });
    expect((await wallet()).book[0].capNear).toBe("1");
  });

  it("pins and unpins an account", async () => {
    await post("/wallet/pin", { address: "acme.testnet" });
    expect((await wallet()).pins).toEqual(["acme.testnet"]);
    await post("/wallet/unpin", { address: "acme.testnet" });
    expect((await wallet()).pins).toEqual([]);
  });

  it("refuses an invalid account or cap", async () => {
    expect((await post("/wallet/remember", { address: "<img src=x>" })).status).toBe(400);
    expect((await post("/wallet/remember", { address: "bob.testnet", capNear: "many" })).status).toBe(400);
    expect((await post("/wallet/pin", {})).status).toBe(400);
  });

  it("counts a co-signed payment as spent", async () => {
    await post("/attack", { preset: "F1" });
    const [p] = await (await fetch(base + "/pending")).json();
    await post("/cosign", { proposalId: p.proposalId, proposalHash: p.proposalHash, remember: true });
    const w = await wallet();
    expect(w.spent24hNear).toBe("1.5");
    expect(w.book[0]).toMatchObject({ address: "attacker.testnet", learnedFrom: "x.com/@attacker" });
  });
});

describe("POST /redteam and /replay", () => {
  it("runs the MOCK red team and summarises it", async () => {
    const r = await (await post("/redteam", {})).json();
    expect(r.rows).toHaveLength(12);
    expect(r.summary).toEqual({ attempts: 12, held: 10, byDesign: 2, failures: 0, unexpected: 0 });
  });

  it("runs the MOCK replay on every fixture", async () => {
    const r = await (await post("/replay", {})).json();
    expect(r.rows).toHaveLength(15);
    expect(r.rows.every((x: any) => x.matchesExpect)).toBe(true);
    expect(r.rows[0].modelOutputs).toBeUndefined();
  });
});

describe("POST /attack", () => {
  it("does not call the model twice for the two baselines", async () => {
    const r = await (await post("/attack", { preset: "F1" })).json();
    expect(r.results[0].label).toBe("drained");
    expect(r.results[1].label).toBe("blocked");
  });
});

describe("LIVE model mode", () => {
  it("can start with simulated payments when asked to, and refuses the MOCK-only runs", async () => {
    await new Promise((r) => server.close(r));
    delete process.env.MOCK;
    await listen(createAppServer({ liveModel: true }));
    const meta = await (await fetch(base + "/meta")).json();
    expect(meta.mode).toBe("LIVE");
    expect(meta.network).toBe("none");
    expect((await post("/redteam", {})).status).toBe(409);
    expect((await post("/replay", {})).status).toBe(409);
  });
});

describe("no static pages", () => {
  it("leaves the pages to the Next.js site", async () => {
    expect((await fetch(base + "/")).status).toBe(404);
    expect((await fetch(base + "/cosign")).status).toBe(404);
    expect((await fetch(base + "/..%2Fpackage.json")).status).toBe(404);
  });
});

describe("read-only chain view, for a wallet to approve against", () => {
  const view = {
    network: "testnet",
    contractId: "taint-x.testnet",
    ownerAccount: "owner-x.testnet",
    getPending: async () => [
      { proposalId: 4, proposalHash: "h4", action: { kind: "Transfer" as const, recipient: "acrne.testnet", token: null, amount: "400000000000000000000000" }, prov: { recipient: { class: "Untrusted" as const, source: "email:x" }, token: null, amount: { class: "Untrusted" as const, source: "email:x" } }, flowHash: "f", createdAt: 1 },
    ],
    getBook: async () => [{ address: "acme.testnet", cap: 10n ** 24n, expiresAt: 5, learnedFrom: "owner" }],
  };

  it("lists the contract's held payments with their source and lookalike warning, using no key", async () => {
    await new Promise((r) => server.close(r));
    await listen(createAppServer({ chainView: view }));
    const items = await (await fetch(base + "/chain/pending")).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ proposalId: 4, proposalHash: "h4", amountNear: "0.4", diff: "acrne.testnet vs acme.testnet: 2 characters differ" });
    expect(items[0].sourceLine).toContain("email:x");
  });

  it("says which contract and which owner account the wallet must use", async () => {
    await new Promise((r) => server.close(r));
    await listen(createAppServer({ chainView: view }));
    expect(await (await fetch(base + "/chain/info")).json()).toEqual({ network: "testnet", contractId: "taint-x.testnet", ownerAccount: "owner-x.testnet" });
  });

  it("is absent unless configured, and is served by the public demo too", async () => {
    expect((await fetch(base + "/chain/info")).status).toBe(404);
    expect((await fetch(base + "/chain/pending")).status).toBe(404);
    await new Promise((r) => server.close(r));
    await listen(createAppServer({ chainView: view, publicDemo: true }));
    expect((await fetch(base + "/chain/info")).status).toBe(200);
  });

  it("reports a node that cannot be reached instead of an empty list", async () => {
    await new Promise((r) => server.close(r));
    await listen(createAppServer({ chainView: { ...view, getPending: async () => { throw new Error("rpc down"); } } }));
    const r = await fetch(base + "/chain/pending");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/rpc down/);
  });
});

describe("chain mode", () => {
  const chain: ChainCosign = {
    network: "testnet",
    getPending: async () => [],
    getBook: async () => [{ address: "a.testnet", cap: 10n ** 24n, expiresAt: 5, learnedFrom: "owner" }],
    getPins: async () => ["p.testnet"],
    getSpent24h: async () => (5n * 10n ** 23n).toString(),
    cosign: async () => ({ txHash: "T" }),
  };

  beforeEach(async () => {
    await new Promise((r) => server.close(r));
    await listen(createAppServer({ chain }));
  });

  it("reads the wallet from the chain and refuses writes", async () => {
    const w = await (await fetch(base + "/wallet")).json();
    expect(w).toMatchObject({ network: "testnet", writable: false, pins: ["p.testnet"], spent24hNear: "0.5" });
    expect(w.book[0].capNear).toBe("1");
    expect((await post("/wallet/remember", { address: "b.testnet" })).status).toBe(409);
  });

  it("does not run the MOCK-only suites", async () => {
    expect((await post("/redteam", {})).status).toBe(409);
    expect((await post("/replay", {})).status).toBe(409);
  });
});
