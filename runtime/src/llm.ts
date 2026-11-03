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

export interface LlmEvent {
  role: LlmRequest["role"];
  key: string;
  output: string;
  /** LIVE only: which provider and model actually answered. */
  provider?: string;
  model?: string;
}

interface Provider {
  name: string;
  baseURL?: string;
  apiKey?: string;
  model: string;
  /** Calls allowed in any rolling hour, so a public site cannot spend more than this. */
  maxPerHour: number;
}

/**
 * NEAR AI Cloud first (when NEAR_AI_API_KEY or NEAR_CLOUD_AI is set), rate limited; the LLM_* provider (Groq) next.
 * With no NEAR key, LLM_* alone, as before.
 */
export function providers(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const list: Provider[] = [];
  const near = env.NEAR_AI_API_KEY ?? env.NEAR_CLOUD_AI;
  if (near) {
    list.push({
      name: "near-ai",
      baseURL: env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1",
      apiKey: near,
      model: env.NEAR_AI_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8",
      maxPerHour: Number(env.NEAR_AI_MAX_PER_HOUR ?? 20),
    });
  }
  if (env.LLM_API_KEY || env.LLM_BASE_URL || !near) {
    list.push({ name: "groq", baseURL: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL ?? "", maxPerHour: Number(env.LLM_MAX_PER_HOUR ?? 120) });
  }
  return list;
}

const HOUR = 60 * 60_000;
const calls = new Map<string, number[]>();
const downUntil = new Map<string, number>();

/** Test hook: forget the rate-limit memory. */
export function resetLlmBudget(): void {
  calls.clear();
  downUntil.clear();
}

function take(p: Provider, now: number): boolean {
  if (p.name === "injected") return true;
  if ((downUntil.get(p.name) ?? 0) > now) return false;
  const recent = (calls.get(p.name) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= p.maxPerHour) {
    calls.set(p.name, recent);
    return false;
  }
  calls.set(p.name, [...recent, now]);
  return true;
}

let tap: ((e: LlmEvent) => void) | undefined;

/** Observe every answer `complete` returns (recording or live). The replay uses it to keep raw model outputs. */
export function setLlmTap(fn: ((e: LlmEvent) => void) | undefined): void {
  tap = fn;
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

const MAX_RETRY_AFTER_MS = 30_000;

/** The server's Retry-After (seconds), if it sent a readable one; 0 otherwise. Capped so a bad header cannot stall a run. */
function retryAfterMs(e: any): number {
  const h = e?.headers;
  const raw = typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"];
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, MAX_RETRY_AFTER_MS) : 0;
}

export async function complete(req: LlmRequest, deps: LlmDeps = {}): Promise<string> {
  const file = recordingPath(req.recordingKey);

  if (mode() === "MOCK") {
    if (!fs.existsSync(file)) throw new Error(`no recording for key ${req.recordingKey} (${file})`);
    const output = JSON.parse(fs.readFileSync(file, "utf8")).output as string;
    tap?.({ role: req.role, key: req.recordingKey, output });
    return output;
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const candidates: Provider[] = deps.client ? [{ name: "injected", model: process.env.LLM_MODEL ?? "", maxPerHour: Infinity }] : providers();

  let res: any;
  let used: Provider | undefined;
  let lastError: unknown = new Error("no model provider is available: each is over its hourly limit or down");
  for (const p of candidates) {
    if (!take(p, Date.now())) continue;
    // maxRetries 0: this function owns retrying, so a flaky endpoint is never hit more than ATTEMPTS times.
    const client: NonNullable<LlmDeps["client"]> =
      deps.client ?? (new OpenAI({ baseURL: p.baseURL, apiKey: p.apiKey, maxRetries: 0 }) as unknown as NonNullable<LlmDeps["client"]>);
    const args = {
      model: p.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "out", schema: req.jsonSchema as Record<string, unknown>, strict: true } } }
        : {}),
    };
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          res = await client.chat.completions.create(args);
          break;
        } catch (e) {
          if (attempt >= ATTEMPTS || !transient(e)) throw e;
          await sleep(Math.max(BACKOFF_MS * 2 ** (attempt - 1), retryAfterMs(e)));
        }
      }
      used = p;
      break;
    } catch (e) {
      lastError = e;
      const status = (e as any)?.status;
      // out of credits or a rejected key: leave this provider alone for a while instead of failing every request first
      if (p.name !== "injected" && (status === 401 || status === 402 || status === 403)) downUntil.set(p.name, Date.now() + 10 * 60_000);
    }
  }
  if (!res) throw lastError;
  const output: string = res.choices[0]?.message?.content ?? "";
  tap?.({ role: req.role, key: req.recordingKey, output, provider: used?.name, model: used?.model });

  if (process.env.RECORD === "1") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ source: "recorded", output }, null, 2));
  }
  return output;
}
