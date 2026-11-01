// Writes bench/recordings/* from the `model_outputs` blocks in bench/fixtures/*.json.
//
// These recordings are HAND-AUTHORED: they say what a model is expected to output, not what one did.
// They exist so MOCK=1 can run offline and deterministically. They prove the plumbing, not model behaviour.
// A LIVE run (`RECORD=1`, with LLM_BASE_URL / LLM_API_KEY / LLM_MODEL set) must replace them before any
// result is published.
import fs from "node:fs";
import path from "node:path";
import { extract, extractorRecordingKey } from "../runtime/src/extractor";
import { HandleStore } from "../runtime/src/handles";
import { recordingPath } from "../runtime/src/llm";
import { naiveRecordingKey } from "../runtime/src/agents/naive";
import { plannerRecordingKey } from "../runtime/src/planner";
import { loadFixtures } from "./replay";

function write(key: string, fixture: string, role: string, output: unknown): void {
  const file = recordingPath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ source: "hand-authored", fixture, role, key, output: JSON.stringify(output) }, null, 2) + "\n",
  );
}

async function main(): Promise<void> {
  process.env.MOCK = "1"; // `extract` below reads back the extractor recordings written just before it
  let n = 0;
  for (const f of loadFixtures()) {
    f.attachments.forEach((a, i) => {
      write(extractorRecordingKey(a), f.id, "extractor", f.model_outputs.extractor[i]);
      n++;
    });
    const store = new HandleStore();
    for (const a of f.attachments) await extract(a, store);
    write(plannerRecordingKey(f.instruction, store.summaries()), f.id, "planner", f.model_outputs.planner);
    write(naiveRecordingKey(f.instruction, f.attachments), f.id, "naive", f.model_outputs.naive);
    n += 2;
  }
  console.log(`wrote ${n} hand-authored recordings to ${path.dirname(recordingPath("x"))}`);
}

main();
