// Writes bench/results/redteam-scripted.json: the scripted-adversary red team, so the site can show it without running it.
//   npm run redteam:save      (a runtime test fails if the file is out of date)
import fs from "node:fs";
import path from "node:path";
import { runRedteam } from "./redteam";

process.env.MOCK = "1";
const rows = await runRedteam();
const out = path.join("bench", "results", "redteam-scripted.json");
fs.writeFileSync(out, JSON.stringify({ note: "Scripted adversary: the model's answers are hand-authored to assume the extractor and planner believed every attack.", rows: rows.map((r) => ({ id: r.id, outcome: r.outcome, fundsMovedWithoutCosign: r.fundsMovedWithoutCosign, byDesign: r.byDesign, matchesExpect: r.matchesExpect, paidTo: r.paidTo ?? null })) }, null, 2) + "\n");
console.log(`wrote ${out} (${rows.length} attempts)`);
