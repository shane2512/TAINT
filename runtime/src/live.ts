// The public site's real path: a visitor connects their own testnet wallet, opens an account in the contract, and
// signs each run with NEP-413. The worker (this server's key) then proposes on chain for that owner's account; the
// owner approves held payments with their own wallet. Nothing here is simulated except the two comparison agents'
// payments (a naive agent's payment is never sent: there is no honest way to drain a visitor to prove a point).
import { createHash, randomBytes } from "node:crypto";
import type http from "node:http";
import { KeyPair } from "@near-js/crypto";
import { AllowlistCapsAgent, type AllowlistConfig } from "./agents/allowlist";
import { MockExecutor } from "./agents/executor";
import { NaiveAgent } from "./agents/naive";
import { TaintAgent } from "./agents/taint";
import type { AgentResult } from "./agents/types";
import { describePending, formatNear } from "./cosign-view";
import { NonceBook, verifyNep413, type KeyCheck, type SignedMessage } from "./nep413";
import type { AccountInfo, ContractClient, NearViewClient } from "./near";
import { signOwnerMessage, type Attachment } from "./owner";
import type { ProposedAction } from "./proposal";
import { provenanceLine } from "./provenance";

export interface Preset {
  id: string;
  title: string;
  kind: "attack" | "legit";
  instruction: string;
  attachments: Attachment[];
}

export interface LiveOptions {
  network: "testnet" | "mainnet";
  contractId: string;
  workerAccount: string;
  view: Pick<NearViewClient, "getAccount" | "getPending" | "getBook" | "getPins" | "getSpent24h">;
  /** A client that proposes as the worker for this owner's account. */
  clientFor: (owner: string) => ContractClient;
  keyCheck: KeyCheck;
  presets: Preset[];
  allowlist: AllowlistConfig;
  /** NEAR a visitor deposits to open an account, shown on the page. */
  suggestedDepositNear?: string;
  limits?: { perOwnerPerHour?: number; perIpPerHour?: number; perDay?: number; maxText?: number };
  now?: () => number;
  label?: (kind: Preset["kind"] | "unknown", r: AgentResult) => string;
}

class Window {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private ms: number, private now: () => number) {}
  /** Count one use of `key`; false once it is over the limit (the use is not counted then). */
  take(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.ms)) this.hits.delete(k);
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.ms);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    this.hits.set(key, [...recent, t]);
    return true;
  }
}

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const MAX_BODY = 20_000;

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) {
        resolve(null);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function createLive(o: LiveOptions, clientId: (req: http.IncomingMessage) => string) {
  const now = o.now ?? Date.now;
  const L = { perOwnerPerHour: 6, perIpPerHour: 12, perDay: 200, maxText: 1500, ...o.limits };
  const byOwner = new Window(L.perOwnerPerHour, 3_600_000, now);
  const byIp = new Window(L.perIpPerHour, 3_600_000, now);
  const today = new Window(L.perDay, 86_400_000, now);
  const nonces = new NonceBook(10 * 60_000, now);
  /** Requests waiting for the wallet's signature: id -> what the owner is being asked to sign. */
  const prepared = new Map<string, { owner: string; message: string; instruction: string; attachments: Attachment[]; kind: Preset["kind"] | "unknown"; preset?: string; at: number }>();

  async function accountView(owner: string) {
    const [account, held, book, pins, spent] = await Promise.all([o.view.getAccount(owner), o.view.getPending(owner), o.view.getBook(owner), o.view.getPins(owner), o.view.getSpent24h(owner)]);
    const near = (e: (typeof book)[number]) => ({ address: e.address, capNear: formatNear(e.cap.toString()), expiresAt: e.expiresAt, learnedFrom: e.learnedFrom });
    return {
      exists: account !== null,
      balanceNear: account ? formatNear(account.balance) : null,
      paused: account?.paused ?? false,
      workerAuthorised: account?.workers.includes(o.workerAccount) ?? false,
      workers: account?.workers ?? [],
      globalCapNear: account ? formatNear(account.config.global_cap_24h) : null,
      config: account?.config ?? null,
      spent24hNear: formatNear(spent),
      held: held.map((p) => describePending(p, book.map((b) => b.address))),
      book: book.map(near),
      pins,
    };
  }

  function expire(): void {
    const t = now();
    for (const [k, v] of prepared) if (t - v.at > 5 * 60_000) prepared.delete(k);
    while (prepared.size > 2000) prepared.delete(prepared.keys().next().value!);
  }

  async function prepare(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const b = await readJson(req);
    const owner = typeof b?.owner === "string" ? b.owner : "";
    if (!ACCOUNT.test(owner)) return send(res, 400, { error: "owner must be a NEAR account" });
    let preset: Preset | undefined;
    let instruction: string;
    let attachments: Attachment[];
    if (typeof b.preset === "string") {
      preset = o.presets.find((p) => p.id === b.preset);
      if (!preset) return send(res, 404, { error: "unknown preset" });
      instruction = preset.instruction;
      attachments = preset.attachments;
    } else if (typeof b.text === "string" && b.text.length > 0 && b.text.length <= L.maxText) {
      instruction = "check this for me";
      attachments = [{ source: typeof b.source === "string" && b.source.trim() ? b.source.trim().slice(0, 80) : "web:rob-page", text: b.text }];
    } else {
      return send(res, 400, { error: `send {preset} or {text} (at most ${L.maxText} characters)` });
    }
    const acct = await o.view.getAccount(owner);
    if (!acct) return send(res, 409, { error: "open your account first", code: "no-account" });
    if (!acct.workers.includes(o.workerAccount)) return send(res, 409, { error: `authorise ${o.workerAccount} as your agent first`, code: "no-worker" });
    if (!byIp.take(clientId(req))) return send(res, 429, { error: `rate limit: ${L.perIpPerHour} runs per hour from one address` });
    if (!byOwner.take(owner)) return send(res, 429, { error: `rate limit: ${L.perOwnerPerHour} runs per hour for one account` });
    if (!today.take("all")) return send(res, 429, { error: "the daily model budget for this site is used up; try again tomorrow" });
    expire();
    const id = randomBytes(12).toString("hex");
    const digest = createHash("sha256").update(JSON.stringify({ instruction, attachments })).digest("hex").slice(0, 16);
    const message = `TAINT run ${id} ${preset ? preset.id : "free-text"} ${digest}`;
    prepared.set(id, { owner, message, instruction, attachments, kind: preset?.kind ?? "unknown", preset: preset?.id, at: now() });
    send(res, 200, { id, message, recipient: o.contractId, instruction, attachments });
  }

  async function run(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const b = await readJson(req);
    const p = typeof b?.id === "string" ? prepared.get(b.id) : undefined;
    if (!p) return send(res, 404, { error: "unknown or expired request: start again" });
    const auth = b.auth as SignedMessage | undefined;
    if (!auth || typeof auth !== "object") return send(res, 400, { error: "send the wallet's signature as {auth}" });
    if (auth.accountId !== p.owner) return send(res, 403, { error: "signed by a different account than the one that asked" });
    const v = await verifyNep413(auth, { recipient: o.contractId, expectMessage: p.message, keyCheck: o.keyCheck, nonces });
    if (!v.ok) return send(res, 403, { error: `signature refused: ${v.why}` });
    prepared.delete(b.id);

    // The wallet's signature is the authority. The agents below take a message signed by a key of this request's own,
    // which only says "this came through the server after the wallet signed it".
    const kp = KeyPair.fromRandom("ed25519");
    const msg = signOwnerMessage(p.instruction, p.attachments, kp);
    const common = { ownerPublicKey: kp.getPublicKey().toString(), network: "none" };
    const taint = new TaintAgent({ client: o.clientFor(p.owner), ownerPublicKey: common.ownerPublicKey, network: o.network });
    let results: AgentResult[];
    try {
      const decisions = new Map<string, Promise<ProposedAction | null>>();
      const naive = new NaiveAgent({ ...common, executor: new MockExecutor(), decisions });
      const allowlist = new AllowlistCapsAgent({ ...common, executor: new MockExecutor(), decisions }, o.allowlist);
      results = [await naive.run(msg), await allowlist.run(msg), await taint.run(msg)];
    } catch (e) {
      return send(res, 502, { error: `the agent could not finish: ${(e as Error).message}` });
    }
    const named = (r: AgentResult) => ({ ...r, path: provenanceLine(r.provenance), label: o.label ? o.label(p.kind, r) : r.outcome });
    send(res, 200, { preset: p.preset, kind: p.kind, results: results.map(named), explorer: results[2].txHash ? `https://${o.network === "mainnet" ? "" : o.network + "."}nearblocks.io/txns/${results[2].txHash}` : null });
  }

  return {
    /** True when the request was handled here. */
    async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
      if (req.method === "GET" && url.pathname === "/live/info") {
        send(res, 200, {
          network: o.network,
          contractId: o.contractId,
          workerAccount: o.workerAccount,
          suggestedDepositNear: o.suggestedDepositNear ?? "2",
          limits: { perOwnerPerHour: L.perOwnerPerHour, perIpPerHour: L.perIpPerHour, perDay: L.perDay },
          presets: o.presets,
        });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/live/account") {
        const owner = url.searchParams.get("owner") ?? "";
        if (!ACCOUNT.test(owner)) {
          send(res, 400, { error: "owner must be a NEAR account" });
          return true;
        }
        try {
          send(res, 200, await accountView(owner));
        } catch (e) {
          send(res, 502, { error: `could not read ${o.network}: ${(e as Error).message}` });
        }
        return true;
      }
      if (req.method === "POST" && url.pathname === "/live/prepare") {
        await prepare(req, res);
        return true;
      }
      if (req.method === "POST" && url.pathname === "/live/run") {
        await run(req, res);
        return true;
      }
      return false;
    },
  };
}

export type { AccountInfo };
