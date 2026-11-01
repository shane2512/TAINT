import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

export interface LlmRequest {
  role: "planner" | "extractor" | "naive";
  system: string;
  user: string;
  jsonSchema?: object;
  recordingKey: string;
}

export function mode(): "LIVE" | "MOCK" {
  return process.env.MOCK === "1" ? "MOCK" : "LIVE";
}

export function recordingPath(key: string): string {
  const dir = process.env.RECORDINGS_DIR ?? path.join(process.cwd(), "bench", "recordings");
  // ':' and other non-portable characters are invalid in Windows filenames.
  return path.join(dir, key.replace(/[^a-zA-Z0-9_.-]/g, "__") + ".json");
}

export async function complete(req: LlmRequest): Promise<string> {
  const file = recordingPath(req.recordingKey);

  if (mode() === "MOCK") {
    if (!fs.existsSync(file)) throw new Error(`no recording for key ${req.recordingKey} (${file})`);
    return JSON.parse(fs.readFileSync(file, "utf8")).output as string;
  }

  const client = new OpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL ?? "",
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    ...(req.jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { name: "out", schema: req.jsonSchema as Record<string, unknown>, strict: true } } }
      : {}),
  });
  const output = res.choices[0]?.message?.content ?? "";

  if (process.env.RECORD === "1") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ source: "recorded", output }, null, 2));
  }
  return output;
}
