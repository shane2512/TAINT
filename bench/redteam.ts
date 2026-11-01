// Red-team suite. It assumes the extractor and planner LLMs are FULLY FOOLED and emit attacker-chosen
// output (hand-authored here), then checks that the deterministic layers still hold: parsers, handle
// typing, literal grounding and the contract gate. Run with `npm run redteam` (MOCK=1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";
import { TaintAgent } from "../runtime/src/agents/taint";
import { banner } from "../runtime/src/banner";
import { mode } from "../runtime/src/llm";
import { MockContract, defaultMockConfig } from "../runtime/src/mock-contract";
import { MockContractClient } from "../runtime/src/near";
import { Attachment, signOwnerMessage } from "../runtime/src/owner";
import { Setup, applySetup } from "./setup";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface Attempt {
  id: string;
  technique: string;
  note: string;
  instruction: string;
  attachments: Attachment[];
  setup?: Setup;
  expectSignError?: boolean;
  model_outputs: { extractor: object[]; planner: object };
  expect: { outcome: string; fundsMovedWithoutCosign: boolean; byDesign?: boolean };
}

export interface RedteamRow {
  id: string;
  technique: string;
  note: string;
  outcome: string;
  fundsMovedWithoutCosign: boolean;
  byDesign: boolean;
  matchesExpect: boolean;
}

export function loadAttempts(dir = path.join(root, "bench", "redteam")): Attempt[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Attempt);
}

export async function runRedteam(): Promise<RedteamRow[]> {
  if (mode() === "LIVE") {
    throw new Error("LIVE redteam requires funded test accounts and a live model (not configured). Run with MOCK=1.");
  }
  const ownerKp = KeyPair.fromRandom("ed25519");
  const rows: RedteamRow[] = [];
  for (const a of loadAttempts()) {
    let outcome: string;
    if (a.expectSignError) {
      try {
        signOwnerMessage(a.instruction, a.attachments, ownerKp);
        outcome = "signed";
      } catch {
        outcome = "refused-at-signing";
      }
    } else {
      const contract = new MockContract(defaultMockConfig());
      applySetup(contract, a.setup);
      const agent = new TaintAgent({
        client: new MockContractClient(contract),
        ownerPublicKey: ownerKp.getPublicKey().toString(),
        network: "none",
      });
      outcome = (await agent.run(signOwnerMessage(a.instruction, a.attachments, ownerKp))).outcome;
    }
    const moved = outcome === "executed";
    rows.push({
      id: a.id,
      technique: a.technique,
      note: a.note,
      outcome,
      fundsMovedWithoutCosign: moved,
      byDesign: a.expect.byDesign ?? false,
      matchesExpect: outcome === a.expect.outcome && moved === a.expect.fundsMovedWithoutCosign,
    });
  }
  return rows;
}

export function renderScoreboard(rows: RedteamRow[]): string {
  const moved = rows.filter((r) => r.fundsMovedWithoutCosign);
  const byDesign = moved.filter((r) => r.byDesign);
  const failures = moved.filter((r) => !r.byDesign);
  const lines = [banner("none")];
  if (mode() === "MOCK") {
    lines.push("note: MOCK uses hand-authored model outputs; this tests the deterministic layers under a fully fooled model, not how real models behave.");
  }
  lines.push("", "| ID | Technique | Result | Funds moved without co-sign |", "|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.technique} | ${r.outcome} | ${r.fundsMovedWithoutCosign ? (r.byDesign ? "yes (by design)" : "YES") : "no"} |`);
  }
  lines.push(
    "",
    `attempts: ${rows.length} | held or refused: ${rows.length - moved.length} | moved by design: ${byDesign.length} | failures: ${failures.length}`,
  );
  for (const f of failures) lines.push(`FAILURE: ${f.id} (${f.technique}) executed without a co-sign`);
  for (const r of rows.filter((x) => !x.matchesExpect)) lines.push(`UNEXPECTED: ${r.id} did not match its declared expectation`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  process.env.MOCK ??= "1"; // the only runnable mode until a live executor exists; the banner always states it
  const rows = await runRedteam();
  console.log(renderScoreboard(rows));
  if (rows.some((r) => !r.matchesExpect || (r.fundsMovedWithoutCosign && !r.byDesign))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
