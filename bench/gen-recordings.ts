// Writes bench/recordings/* from the `model_outputs` blocks in bench/fixtures/*.json and bench/redteam/*.json.
//
// These recordings are HAND-AUTHORED: they say what a model is expected to output, not what one did.
// They exist so MOCK=1 can run offline and deterministically. They prove the plumbing, not model behaviour.
// A LIVE run (`RECORD=1`, with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL set) must replace them before any
// result is published.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { naiveRecordingKey } from "../runtime/src/agents/naive";
import { extract, extractorRecordingKey } from "../runtime/src/extractor";
import { HandleStore } from "../runtime/src/handles";
import { recordingPath } from "../runtime/src/llm";
import { plannerRecordingKey } from "../runtime/src/planner";
import { Attempt, loadAttempts } from "./redteam";
import { Fixture, loadFixtures } from "./replay";

/** Returns the number of distinct recordings written. Throws if two cases need different outputs for one prompt. */
export async function generateRecordings(fixtures: Fixture[], attempts: Attempt[]): Promise<number> {
  const written = new Map<string, { output: string; owner: string }>();

  const write = (key: string, owner: string, role: string, output: unknown): void => {
    const file = recordingPath(key);
    const text = JSON.stringify(output);
    const prior = written.get(file);
    if (prior) {
      // The planner sees only the owner's text and coarse handle summaries, so identical prompts are
      // expected. They must therefore have identical recorded outputs.
      if (prior.output !== text) {
        throw new Error(`recording key collision on ${key}: ${prior.owner} and ${owner} need different outputs for the same prompt`);
      }
      return;
    }
    written.set(file, { output: text, owner });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ source: "hand-authored", fixture: owner, role, key, output: text }, null, 2) + "\n",
    );
  };

  const cases = [
    ...fixtures.map((f) => ({ id: f.id, instruction: f.instruction, attachments: f.attachments, outputs: f.model_outputs, naive: true, skip: false })),
    ...attempts.map((a) => ({ id: a.id, instruction: a.instruction, attachments: a.attachments, outputs: { ...a.model_outputs, naive: undefined }, naive: false, skip: !!a.expectSignError })),
  ];

  const prevMock = process.env.MOCK;
  process.env.MOCK = "1"; // `extract` below reads back the extractor recordings written just before it
  try {
    for (const c of cases) {
      if (c.skip) continue; // refused at signing: no model is ever called
      c.attachments.forEach((a, i) => write(extractorRecordingKey(a), c.id, "extractor", c.outputs.extractor[i]));
      const store = new HandleStore();
      for (const a of c.attachments) await extract(a, store);
      write(plannerRecordingKey(c.instruction, store.summaries()), c.id, "planner", c.outputs.planner);
      if (c.naive) write(naiveRecordingKey(c.instruction, c.attachments), c.id, "naive", c.outputs.naive);
    }
  } finally {
    if (prevMock === undefined) delete process.env.MOCK;
    else process.env.MOCK = prevMock;
  }
  return written.size;
}

async function main(): Promise<void> {
  const n = await generateRecordings(loadFixtures(), loadAttempts());
  console.log(`wrote ${n} hand-authored recordings to ${path.dirname(recordingPath("x"))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
