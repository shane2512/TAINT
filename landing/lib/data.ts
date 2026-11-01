// Read at build time from the repo's own files, so the pages cannot drift from the saved results.
import fs from "node:fs";
import path from "node:path";

// Next to the repo: its bench/ folder. Deployed alone: the copy that scripts/sync-data.mjs keeps in data/.
const repo = path.resolve(process.cwd(), "..");
const root = fs.existsSync(path.join(repo, "bench")) ? repo : path.resolve(process.cwd(), "data");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p));

export interface FixtureView { id: string; title: string; kind: string; instruction: string; attachments: { source: string; text: string }[]; flagged: string[]; taint: string; sources: string[] }
export function fixtures(): FixtureView[] {
  const dir = path.join(root, "bench", "fixtures");
  return fs.readdirSync(dir).sort().map((f) => {
    const d = json("bench", "fixtures", f);
    const flagged = (d.model_outputs.extractor as { accounts: string[]; tokens: string[]; amounts: string[] }[]).flatMap((e) => [...e.accounts, ...e.tokens, ...e.amounts]);
    return { id: d.id, title: d.title, kind: d.kind, instruction: d.instruction, attachments: d.attachments, flagged, taint: d.expect.taint, sources: d.source_urls ?? [] };
  });
}

export type Matrix = Record<string, Record<string, Record<string, number>>>; // fixture -> agent -> outcome -> count
export interface LiveReplay { at: string; model: string; runs: number; total: number; errors: number; matrix: Matrix }
export function liveReplay(): LiveReplay {
  const dir = path.join(root, "bench", "results");
  const file = fs.readdirSync(dir).filter((f) => f.endsWith("-LIVE.json")).sort().at(-1)!;
  const d = json("bench", "results", file);
  const matrix: Matrix = {};
  for (const r of d.rows) ((matrix[r.fixture] ??= {})[r.agent] ??= {})[r.outcome] = ((matrix[r.fixture][r.agent] ??= {})[r.outcome] ?? 0) + 1;
  const counts = Object.values(Object.values(matrix)[0].taint);
  return { at: d.at, model: d.model, runs: counts.reduce((a, b) => a + b, 0), total: d.rows.length, errors: d.rows.filter((r: { outcome: string }) => r.outcome === "error").length, matrix };
}

export interface LiveRedteam { file: string; model: string; attempts: number; held: number; byDesign: number; failures: number; errors: number }
export function liveRedteams(): LiveRedteam[] {
  const dir = path.join(root, "bench", "results");
  return fs.readdirSync(dir).filter((f) => /redteam.*\.md$/.test(f)).sort().map((file) => {
    const t = read("bench", "results", file);
    const m = t.match(/attempts: (\d+) \| held or refused: (\d+) \| moved by design: (\d+) \| failures: (\d+)/)!;
    return {
      file,
      model: t.match(/LIVE model (\S+);/)?.[1] ?? "unknown",
      attempts: +m[1], held: +m[2], byDesign: +m[3], failures: +m[4],
      errors: (t.match(/^\| R\d+ \|[^|]*\| error \|/gm) ?? []).length,
    };
  });
}

export interface AttemptView { id: string; technique: string; note: string }
export function attempts(): AttemptView[] {
  const dir = path.join(root, "bench", "redteam");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const { id, technique, note } = json("bench", "redteam", f);
    return { id, technique, note };
  });
}

export const policyCaseCount = (): number => json("bench", "policy-cases.json").cases.length;
