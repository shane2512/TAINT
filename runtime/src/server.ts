import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";
import { applySetup } from "../../bench/setup";
import { loadTable, runCase } from "../../bench/policy-runner";
import { runRedteam } from "../../bench/redteam";
import { label, loadFixtures, runReplay } from "../../bench/replay";
import { AllowlistCapsAgent, loadConfig } from "./agents/allowlist";
import { MockExecutor } from "./agents/executor";
import { NaiveAgent } from "./agents/naive";
import { TaintAgent } from "./agents/taint";
import type { AgentResult } from "./agents/types";
import { banner } from "./banner";
import { describePending, formatNear } from "./cosign-view";
import { parseAccount, parseAmountYocto } from "./handles";
import { mode } from "./llm";
import { MockContract, defaultMockConfig, type BookEntry, type PendingProposal } from "./mock-contract";
import { MockContractClient } from "./near";
import { signOwnerMessage } from "./owner";
import type { ArgProvenance, Provenance, ProposedAction } from "./proposal";
import { provenanceLine } from "./provenance";

const here = path.dirname(fileURLToPath(import.meta.url));
const baselineConfig = path.resolve(here, "../../baselines/allowlist.json");

const RATE_LIMIT = Number(process.env.ATTACK_RATE_LIMIT ?? 10);
const RATE_WINDOW_MS = 60_000;
const MAX_BODY = 20_000;
const LOG_SIZE = 100;

/** A real network behind the co-sign page: held proposals are read from the chain and approvals go out as relayed delegates. */
export interface ChainCosign {
  network: string;
  getPending(): Promise<PendingProposal[]>;
  getBook(): Promise<BookEntry[]>;
  getPins(): Promise<string[]>;
  getSpent24h(): Promise<string>;
  cosign(proposalId: number, proposalHash: string, remember: boolean): Promise<{ txHash: string; failure?: string }>;
}

export interface ServerOptions {
  chain?: ChainCosign;
  /** A real model with simulated payments, so free-text attacks work. Nothing touches a chain. */
  liveModel?: boolean;
  now?: () => number;
  ownerKp?: KeyPair;
  contract?: MockContract;
  /** For hosting in public: no free text (it spends a model quota) and nothing but simulated payments. */
  publicDemo?: boolean;
  /** Believe the x-client-ip header, set by the site's proxy, when counting attacks per visitor. */
  trustProxy?: boolean;
  /** If set, the forwarded address is believed only when the proxy sends this key in x-proxy-key. */
  proxyKey?: string;
  /** Visitors kept at once; the least recently seen is dropped. */
  maxSessions?: number;
}

/** Everything that belongs to one visitor. */
interface Visitor {
  contract: MockContract;
  taint: TaintAgent;
  log: LogEntry[];
}

interface LogEntry {
  ts: number;
  preset?: string;
  text?: string;
  naive: { outcome: string };
  allowlist: { outcome: string };
  taint: { outcome: string; path: string; reasons: string[] };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function createAppServer(o: ServerOptions = {}): http.Server {
  if (mode() === "LIVE" && !o.chain && !o.liveModel) {
    throw new Error("LIVE server requires funded test accounts and a live executor (not configured). Run with MOCK=1.");
  }
  if (o.publicDemo && (o.chain || o.liveModel)) throw new Error("a public demo runs on simulated payments and recorded model answers only");
  const now = o.now ?? Date.now;
  const ownerKp = o.ownerKp ?? KeyPair.fromRandom("ed25519");
  const common = { ownerPublicKey: ownerKp.getPublicKey().toString(), network: "none" };
  const cfg = loadConfig(baselineConfig);
  const mockCfg = defaultMockConfig(now);
  const hits = new Map<string, number[]>();

  // One wallet per visitor, keyed by the id the site's proxy keeps in a cookie. Without one, everyone shares "default".
  const visitors = new Map<string, Visitor>();
  const maxSessions = o.maxSessions ?? 500;
  const newVisitor = (c?: MockContract): Visitor => {
    const contract = c ?? new MockContract(defaultMockConfig(now));
    return { contract, taint: new TaintAgent({ client: new MockContractClient(contract), ...common }), log: [] };
  };
  function visitor(req: http.IncomingMessage): Visitor {
    const raw = req.headers["x-taint-session"];
    const id = typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : "default";
    let v = visitors.get(id);
    if (v) visitors.delete(id); // re-insert below, so the map stays in order of last use
    v ??= newVisitor(id === "default" ? o.contract : undefined);
    visitors.set(id, v);
    while (visitors.size > maxSessions) visitors.delete(visitors.keys().next().value!);
    return v;
  }
  const clientId = (req: http.IncomingMessage): string => {
    const fwd = req.headers["x-client-ip"];
    const trusted = o.trustProxy && (!o.proxyKey || req.headers["x-proxy-key"] === o.proxyKey);
    return trusted && typeof fwd === "string" && fwd ? fwd.slice(0, 64) : (req.socket.remoteAddress ?? "?");
  };

  const allowed = (ip: string): boolean => {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      hits.set(ip, recent);
      return false;
    }
    hits.set(ip, [...recent, t]);
    return true;
  };

  async function attack(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!allowed(clientId(req))) return json(res, 429, { error: `rate limit: ${RATE_LIMIT} attacks per minute` });
    const { contract, taint, log } = visitor(req);
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }

    let instruction: string;
    let attachments;
    let kind: "attack" | "legit" | "unknown" = "unknown";
    let preset: string | undefined;
    if (typeof body?.preset === "string") {
      const f = loadFixtures().find((x) => x.id === body.preset);
      if (!f) return json(res, 404, { error: "unknown preset" });
      preset = f.id;
      kind = f.kind;
      instruction = f.instruction;
      attachments = f.attachments;
      applySetup(contract, f.setup);
    } else if (o.publicDemo && typeof body?.text === "string") {
      return json(res, 403, { error: "free-text attacks are off on the public demo; run the repository locally with a live model" });
    } else if (typeof body?.text === "string" && body.text.length > 0 && body.text.length <= 2000) {
      instruction = "check this for me";
      attachments = [{ source: typeof body.source === "string" ? body.source.slice(0, 80) : "web:rob-page", text: body.text }];
    } else {
      return json(res, 400, { error: "send {preset} or {text} (at most 2000 characters)" });
    }

    const msg = signOwnerMessage(instruction, attachments, ownerKp);
    let results: AgentResult[];
    try {
      // One model decision, judged by both baselines; otherwise two live calls could disagree.
      const decisions = new Map<string, Promise<ProposedAction | null>>();
      const naive = new NaiveAgent({ ...common, executor: new MockExecutor(), now, decisions });
      const allowlist = new AllowlistCapsAgent({ ...common, executor: new MockExecutor(), now, decisions }, cfg);
      results = [await naive.run(msg), await allowlist.run(msg), await taint.run(msg)];
    } catch (e) {
      if (/no recording for key/.test(String((e as Error).message))) {
        return json(res, 501, { error: "free-text attacks need a live model; MOCK only has recordings for the presets" });
      }
      throw e;
    }

    const withExtras = results.map((r) => ({
      ...r,
      path: provenanceLine(r.provenance),
      label: kind === "unknown" ? r.outcome : label(kind, r.outcome),
    }));
    log.push({
      ts: now(),
      preset,
      text: preset ? undefined : attachments[0].text,
      naive: { outcome: withExtras[0].label },
      allowlist: { outcome: withExtras[1].label },
      taint: { outcome: withExtras[2].label, path: withExtras[2].path, reasons: results[2].reasons ?? [] },
    });
    if (log.length > LOG_SIZE) log.shift();
    json(res, 200, { preset, kind, results: withExtras });
  }

  async function cosign(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { contract } = visitor(req);
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }
    if (typeof body?.proposalId !== "number" || typeof body?.proposalHash !== "string") {
      return json(res, 400, { error: "send {proposalId, proposalHash, remember}" });
    }
    try {
      if (o.chain) {
        const r = await o.chain.cosign(body.proposalId, body.proposalHash, body.remember === true);
        if (r.failure) return json(res, 400, { error: "chain refused: " + r.failure, txHash: r.txHash });
        const host = o.chain.network === "mainnet" ? "" : o.chain.network + ".";
        return json(res, 200, { txHash: r.txHash, explorer: `https://${host}nearblocks.io/txns/${r.txHash}` });
      }
      json(res, 200, contract.cosign(body.proposalId, body.proposalHash, body.remember === true));
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  }

  async function jsonBody(req: http.IncomingMessage): Promise<any> {
    try {
      return JSON.parse(await readBody(req));
    } catch {
      return null;
    }
  }

  /** Runs one proposal through the real rules, on a fresh contract, so nothing here touches the wallet's state. */
  async function policyEvaluate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const b = await jsonBody(req);
    const bad = (error: string) => json(res, 400, { error });
    if (b?.kind !== "Transfer" && b?.kind !== "Swap") return bad("kind must be Transfer or Swap");
    const amount = parseAmountYocto(`${b.amountNear} NEAR`);
    if (!amount) return bad("amountNear must be a NEAR amount");
    const target = parseAccount(String(b.kind === "Transfer" ? b.recipient : b.token));
    if (!target) return bad(`${b.kind === "Transfer" ? "recipient" : "token"} must be a NEAR account`);
    const source = (v: unknown): Provenance => {
      const s = typeof v === "string" && v.trim() ? v.trim().slice(0, 128) : "owner";
      return s === "owner" ? { class: "Owner", source: "owner" } : { class: "Untrusted", source: s };
    };
    const c = new MockContract(defaultMockConfig(now));
    if (b.spentNear) {
      const spent = parseAmountYocto(`${b.spentNear} NEAR`);
      if (!spent) return bad("spentNear must be a NEAR amount");
      const owner: Provenance = { class: "Owner", source: "owner" };
      c.propose({ kind: "Transfer", recipient: "spent.testnet", token: null, amount: spent }, { recipient: owner, token: null, amount: owner }, "spent");
    }
    if (b.remembered) c.remember(target);
    if (b.pinnedPayee) {
      c.pin("pinned.testnet");
      c.registerPayee("pinned.testnet", target);
    }
    const action: ProposedAction = { kind: b.kind, recipient: b.kind === "Transfer" ? target : null, token: b.kind === "Swap" ? target : null, amount };
    const prov: ArgProvenance = { recipient: b.kind === "Transfer" ? source(b.recipientSource) : null, token: b.kind === "Swap" ? source(b.tokenSource) : null, amount: source(b.amountSource) };
    const out = c.propose(action, prov, "evaluate");
    if ("Executed" in out) return json(res, 200, { decision: "executed", reasons: [] });
    if ("Pending" in out) return json(res, 200, { decision: "held", reasons: out.Pending.reasons });
    json(res, 200, { decision: "rejected", reasons: [out.Rejected.reason] });
  }

  async function walletView(req: http.IncomingMessage): Promise<object> {
    const { contract } = visitor(req);
    const near = (e: BookEntry) => ({ address: e.address, capNear: formatNear(e.cap.toString()), expiresAt: e.expiresAt, learnedFrom: e.learnedFrom });
    if (o.chain) {
      const [book, pins, spent] = await Promise.all([o.chain.getBook(), o.chain.getPins(), o.chain.getSpent24h()]);
      return { network: o.chain.network, writable: false, book: book.map(near), pins, spent24hNear: formatNear(spent), globalCapNear: null };
    }
    return { network: "none", writable: true, book: contract.getBook().map(near), pins: contract.getPins(), spent24hNear: formatNear(contract.spent24h().toString()), globalCapNear: formatNear(mockCfg.globalCap24h.toString()) };
  }

  async function walletWrite(op: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (o.chain) return json(res, 409, { error: "the wallet is read-only on a real network: owner calls are not exposed here" });
    const { contract } = visitor(req);
    const b = await jsonBody(req);
    const address = parseAccount(String(b?.address ?? ""));
    if (!address) return json(res, 400, { error: "that is not a NEAR account" });
    if (op === "remember") {
      const cap = b.capNear ? parseAmountYocto(`${b.capNear} NEAR`) : undefined;
      if (cap === null) return json(res, 400, { error: "the cap must be a NEAR amount" });
      contract.remember(address, cap ? BigInt(cap) : undefined);
    } else if (op === "forget") contract.forget(address);
    else if (op === "pin") contract.pin(address);
    else contract.unpin(address);
    json(res, 200, await walletView(req));
  }

  const mockOnly = (res: http.ServerResponse) => json(res, 409, { error: "this suite runs on hand-authored model outputs, so it only runs with MOCK=1" });

  async function redteam(res: http.ServerResponse): Promise<void> {
    if (o.chain || mode() !== "MOCK") return mockOnly(res);
    const rows = await runRedteam();
    const moved = rows.filter((r) => r.fundsMovedWithoutCosign);
    const byDesign = moved.filter((r) => r.byDesign).length;
    json(res, 200, { rows, summary: { attempts: rows.length, held: rows.length - moved.length, byDesign, failures: moved.length - byDesign, unexpected: rows.filter((r) => !r.matchesExpect).length } });
  }

  async function replay(res: http.ServerResponse): Promise<void> {
    if (o.chain || mode() !== "MOCK") return mockOnly(res);
    const rows = await runReplay(loadFixtures().map((f) => f.id));
    json(res, 200, { rows: rows.map((r) => ({ fixture: r.fixture, agent: r.agent, outcome: r.outcome, expected: r.expected, matchesExpect: r.matchesExpect, reasons: r.reasons })) });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/attack") return o.chain ? json(res, 404, { error: "not found" }) : await attack(req, res);
      if (req.method === "POST" && url.pathname === "/cosign") return await cosign(req, res);
      if (req.method === "POST" && url.pathname === "/policy/evaluate") return await policyEvaluate(req, res);
      if (req.method === "POST" && url.pathname === "/redteam") return await redteam(res);
      if (req.method === "POST" && url.pathname === "/replay") return await replay(res);
      if (req.method === "POST" && /^\/wallet\/(remember|forget|pin|unpin)$/.test(url.pathname)) return await walletWrite(url.pathname.slice(8), req, res);
      if (req.method === "GET" && url.pathname === "/wallet") return json(res, 200, await walletView(req));
      if (req.method === "GET" && url.pathname === "/policy/cases") {
        const table = loadTable();
        return json(res, 200, table.cases.map((c) => {
          const failures = runCase(c.steps, table.config);
          return { name: c.name, steps: c.steps.length, pass: failures.length === 0, failures };
        }));
      }
      if (req.method === "GET" && url.pathname === "/log") return json(res, 200, visitor(req).log);
      if (req.method === "GET" && url.pathname === "/pending" && o.chain) {
        const [held, book] = await Promise.all([o.chain.getPending(), o.chain.getBook()]);
        return json(res, 200, held.map((p) => describePending(p, book.map((b) => b.address))));
      }
      if (req.method === "GET" && url.pathname === "/pending") {
        const { contract } = visitor(req);
        return json(res, 200, contract.getPending().map((p) => describePending(p, contract.knownCounterparties())));
      }
      if (req.method === "GET" && url.pathname === "/meta") {
        return json(res, 200, {
          banner: o.chain ? `[taint] network=${o.chain.network} real-chain co-sign (demo owner key from .env, not a wallet) ATTESTATION STUBBED` : banner("none"),
          network: o.chain?.network ?? "none",
          publicDemo: o.publicDemo === true,
          mode: mode(),
          presets: loadFixtures().map((f) => ({ id: f.id, title: f.title, kind: f.kind, instruction: f.instruction, attachments: f.attachments })),
        });
      }
      json(res, req.method === "GET" ? 404 : 405, { error: req.method === "GET" ? "not found" : "method not allowed" });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message ?? e) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const liveModel = process.argv.includes("--live-model");
  if (liveModel) {
    if (fs.existsSync(".env")) process.loadEnvFile(".env");
    delete process.env.MOCK;
  } else {
    process.env.MOCK ??= "1";
  }
  const port = Number(process.env.PORT ?? 3000);
  const publicDemo = process.env.PUBLIC_DEMO === "1";
  const host = process.env.HOST ?? "127.0.0.1";
  createAppServer({ liveModel, publicDemo, trustProxy: process.env.TRUST_PROXY === "1", proxyKey: process.env.PROXY_KEY }).listen(port, host, () => {
    console.log(banner("none"));
    console.log(`TAINT API: http://127.0.0.1:${port}/   The pages are in landing/: npm run site`);
  });
}
