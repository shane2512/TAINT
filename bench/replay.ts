import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";
import { AllowlistCapsAgent, loadConfig } from "../runtime/src/agents/allowlist";
import { MockExecutor } from "../runtime/src/agents/executor";
import { NaiveAgent } from "../runtime/src/agents/naive";
import { TaintAgent } from "../runtime/src/agents/taint";
import type { Agent, AgentResult } from "../runtime/src/agents/types";
import { banner } from "../runtime/src/banner";
import { mode } from "../runtime/src/llm";
import { MockContract, defaultMockConfig } from "../runtime/src/mock-contract";
import { MockContractClient } from "../runtime/src/near";
import { Attachment, signOwnerMessage } from "../runtime/src/owner";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Label = "drained" | "ok" | "blocked" | "pending";

export interface Fixture {
  id: string;
  title: string;
  kind: "attack" | "legit";
  source_urls: string[];
  instruction: string;
  attachments: Attachment[];
  setup?: { pins?: string[]; payees?: { by: string; address: string }[] };
  expect: { naive: Label; allowlist: Label; taint: Label };
  model_outputs: { extractor: object[]; planner: object; naive: object };
}

export interface Row {
  fixture: string;
  agent: AgentResult["agent"];
  outcome: Label;
  expected: Label;
  matchesExpect: boolean;
  txHash?: string;
  reasons?: string[];
  provenance?: AgentResult["provenance"];
  network: string;
  mode: "LIVE" | "MOCK";
}

export function loadFixtures(dir = path.join(root, "bench", "fixtures")): Fixture[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Fixture);
}

function label(kind: Fixture["kind"], outcome: AgentResult["outcome"]): Label {
  if (outcome === "executed") return kind === "attack" ? "drained" : "ok";
  return outcome === "pending" ? "pending" : "blocked";
}

export async function runReplay(ids: string[], runs = 1): Promise<Row[]> {
  if (mode() === "LIVE") {
    throw new Error("LIVE replay requires a live executor and funded test accounts (not configured). Run with MOCK=1.");
  }
  const network = "none"; // MOCK touches no chain
  const all = loadFixtures();
  const cfg = loadConfig(path.join(root, "baselines", "allowlist.json"));
  const ownerKp = KeyPair.fromRandom("ed25519");
  const ownerPublicKey = ownerKp.getPublicKey().toString();
  const rows: Row[] = [];

  for (const id of ids) {
    const f = all.find((x) => x.id === id);
    if (!f) throw new Error(`unknown fixture ${id}`);
    for (let run = 0; run < runs; run++) {
      const contract = new MockContract(defaultMockConfig());
      for (const p of f.setup?.pins ?? []) contract.pin(p);
      for (const p of f.setup?.payees ?? []) contract.registerPayee(p.by, p.address);
      const common = { ownerPublicKey, network };
      const agents: Agent[] = [
        new NaiveAgent({ ...common, executor: new MockExecutor() }),
        new AllowlistCapsAgent({ ...common, executor: new MockExecutor() }, cfg),
        new TaintAgent({ client: new MockContractClient(contract), ...common }),
      ];
      const msg = signOwnerMessage(f.instruction, f.attachments, ownerKp);
      for (const agent of agents) {
        const r = await agent.run(msg);
        const outcome = label(f.kind, r.outcome);
        const expected = f.expect[agent.name];
        rows.push({
          fixture: f.id,
          agent: agent.name,
          outcome,
          expected,
          matchesExpect: outcome === expected,
          txHash: r.txHash,
          reasons: r.reasons,
          provenance: r.provenance,
          network: r.network,
          mode: r.mode,
        });
      }
    }
  }
  return rows;
}

function path_(r: Row): string {
  const p = r.provenance;
  if (!p) return "";
  return (["recipient", "token", "amount"] as const)
    .filter((k) => p[k]?.class === "Untrusted")
    .map((k) => `${k} <- ${p[k]!.source}`)
    .join("; ");
}

const NAMES: Record<AgentResult["agent"], string> = { naive: "Naive", allowlist: "Allowlist+Caps", taint: "TAINT" };

export function renderTable(rows: Row[]): string {
  const note =
    rows[0]?.mode === "MOCK"
      ? "note: MOCK uses hand-authored model outputs (bench/gen-recordings.ts); this shows the plumbing, not model behaviour."
      : "";
  const lines = [banner(rows[0]?.network ?? "none"), note, "", "| Fixture | Agent | Result | Expected | Match | Network | Mode | Detail |", "|---|---|---|---|---|---|---|---|"];
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(`${r.fixture}/${r.agent}`, [...(groups.get(`${r.fixture}/${r.agent}`) ?? []), r]);
  for (const g of groups.values()) {
    const first = g[0];
    const counts = new Map<Label, number>();
    for (const r of g) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    const result =
      g.length === 1 ? first.outcome : [...counts].map(([l, n]) => `${l} ${n}/${g.length}`).join(", ");
    const match = g.every((r) => r.matchesExpect) ? "yes" : "NO";
    const detail = path_(first) || (first.reasons ?? []).join("; ");
    lines.push(`| ${first.fixture} | ${NAMES[first.agent]} | ${result} | ${first.expected} | ${match} | ${first.network} | ${first.mode} | ${detail} |`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string, d: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : d);
  const ids = get("--fixtures", "F1,F3,L1,L2").split(",");
  const rows = await runReplay(ids, Number(get("--runs", "1")));
  console.log(renderTable(rows));
  if (rows.some((r) => !r.matchesExpect)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
