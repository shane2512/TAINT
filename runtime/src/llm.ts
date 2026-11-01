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

/** Injectable for tests. */
export interface LlmDeps {
  client?: { chat: { completions: { create: (args: any) => Promise<any> } } };
  sleep?: (ms: number) => Promise<void>;
}

export function mode(): "LIVE" | "MOCK" {
  return process.env.MOCK === "1" ? "MOCK" : "LIVE";
}

export function recordingPath(key: string): string {
  const dir = process.env.RECORDINGS_DIR ?? path.join(process.cwd(), "bench", "recordings");
  // ':' and other non-portable characters are invalid in Windows filenames.
  return path.join(dir, key.replace(/[^a-zA-Z0-9_.-]/g, "__") + ".json");
}

const ATTEMPTS = 3;
const BACKOFF_MS = 1000;

/** Rate limits, server errors, dropped connections, and Groq's occasional strict-schema generation failure. */
function transient(e: any): boolean {
  const status: number | undefined = e?.status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (status === 400 && /Failed to generate JSON/i.test(String(e?.message))) return true;
  return e?.name === "APIConnectionError" || e?.name === "APIConnectionTimeoutError";
}

export async function complete(req: LlmRequest, deps: LlmDeps = {}): Promise<string> {
  const file = recordingPath(req.recordingKey);

  if (mode() === "MOCK") {
    if (!fs.existsSync(file)) throw new Error(`no recording for key ${req.recordingKey} (${file})`);
    return JSON.parse(fs.readFileSync(file, "utf8")).output as string;
  }

  // maxRetries 0: this function owns retrying, so a flaky endpoint is never hit more than ATTEMPTS times.
  const client: NonNullable<LlmDeps["client"]> =
    deps.client ??
    (new OpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, maxRetries: 0 }) as unknown as NonNullable<LlmDeps["client"]>);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const args = {
    model: process.env.LLM_MODEL ?? "",
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    ...(req.jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { name: "out", schema: req.jsonSchema as Record<string, unknown>, strict: true } } }
      : {}),
  };

  let res: any;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await client.chat.completions.create(args);
      break;
    } catch (e) {
      if (attempt >= ATTEMPTS || !transient(e)) throw e;
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  const output: string = res.choices[0]?.message?.content ?? "";

  if (process.env.RECORD === "1") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ source: "recorded", output }, null, 2));
  }
  return output;
}
