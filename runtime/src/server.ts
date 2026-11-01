import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";
import { applySetup } from "../../bench/setup";
import { label, loadFixtures } from "../../bench/replay";
import { AllowlistCapsAgent, loadConfig } from "./agents/allowlist";
import { MockExecutor } from "./agents/executor";
import { NaiveAgent } from "./agents/naive";
import { TaintAgent } from "./agents/taint";
import type { AgentResult } from "./agents/types";
import { banner } from "./banner";
import { describePending } from "./cosign-view";
import { mode } from "./llm";
import { MockContract, defaultMockConfig } from "./mock-contract";
import { MockContractClient } from "./near";
import { signOwnerMessage } from "./owner";
import { provenanceLine } from "./provenance";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "../../web");
const baselineConfig = path.resolve(here, "../../baselines/allowlist.json");

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY = 20_000;
const LOG_SIZE = 100;

export interface ServerOptions {
  now?: () => number;
  ownerKp?: KeyPair;
  contract?: MockContract;
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
  if (mode() === "LIVE") {
    throw new Error("LIVE server requires funded test accounts and a live executor (not configured). Run with MOCK=1.");
  }
  const now = o.now ?? Date.now;
  const ownerKp = o.ownerKp ?? KeyPair.fromRandom("ed25519");
  const contract = o.contract ?? new MockContract(defaultMockConfig(now));
  const common = { ownerPublicKey: ownerKp.getPublicKey().toString(), network: "none" };
  const taint = new TaintAgent({ client: new MockContractClient(contract), ...common });
  const cfg = loadConfig(baselineConfig);
  const hits = new Map<string, number[]>();
  const log: LogEntry[] = [];

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
    if (!allowed(req.socket.remoteAddress ?? "?")) return json(res, 429, { error: "rate limit: 10 attacks per minute" });
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
    } else if (typeof body?.text === "string" && body.text.length > 0 && body.text.length <= 2000) {
      instruction = "check this for me";
      attachments = [{ source: typeof body.source === "string" ? body.source.slice(0, 80) : "web:rob-page", text: body.text }];
    } else {
      return json(res, 400, { error: "send {preset} or {text} (at most 2000 characters)" });
    }

    const msg = signOwnerMessage(instruction, attachments, ownerKp);
    let results: AgentResult[];
    try {
      const naive = new NaiveAgent({ ...common, executor: new MockExecutor(), now });
      const allowlist = new AllowlistCapsAgent({ ...common, executor: new MockExecutor(), now }, cfg);
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
      json(res, 200, contract.cosign(body.proposalId, body.proposalHash, body.remember === true));
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  }

  function serveStatic(urlPath: string, res: http.ServerResponse): void {
    let name: string;
    try {
      name = urlPath === "/" ? "index.html" : urlPath === "/cosign" ? "cosign.html" : decodeURIComponent(urlPath.slice(1));
    } catch {
      return json(res, 404, { error: "not found" });
    }
    if (!/^[a-zA-Z0-9_-]+\.(html|js|css)$/.test(name)) return json(res, 404, { error: "not found" });
    const file = path.join(webDir, name);
    if (!fs.existsSync(file)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[path.extname(name)] });
    res.end(fs.readFileSync(file));
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/attack") return await attack(req, res);
      if (req.method === "POST" && url.pathname === "/cosign") return await cosign(req, res);
      if (req.method === "GET" && url.pathname === "/log") return json(res, 200, log);
      if (req.method === "GET" && url.pathname === "/pending") {
        return json(res, 200, contract.getPending().map((p) => describePending(p, contract.knownCounterparties())));
      }
      if (req.method === "GET" && url.pathname === "/meta") {
        return json(res, 200, {
          banner: banner("none"),
          presets: loadFixtures().map((f) => ({ id: f.id, title: f.title, kind: f.kind })),
        });
      }
      if (req.method === "GET") return serveStatic(url.pathname, res);
      json(res, 405, { error: "method not allowed" });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message ?? e) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.MOCK ??= "1";
  const port = Number(process.env.PORT ?? 3000);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(banner("none"));
    console.log(`Rob the Pet: http://127.0.0.1:${port}/   Co-sign: http://127.0.0.1:${port}/cosign`);
  });
}
