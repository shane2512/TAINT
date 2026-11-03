import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { complete, mode, setLlmTap } from "../src/llm";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-rec-"));
  process.env.RECORDINGS_DIR = dir;
  process.env.MOCK = "1";
});
afterEach(() => {
  delete process.env.RECORDINGS_DIR;
  delete process.env.MOCK;
  fs.rmSync(dir, { recursive: true, force: true });
});

const req = (recordingKey: string) => ({
  role: "planner" as const,
  system: "s",
  user: "u",
  recordingKey,
});

describe("llm client", () => {
  it("returns the recorded output under MOCK=1", async () => {
    fs.writeFileSync(path.join(dir, "k1.json"), JSON.stringify({ output: "hello" }));
    expect(await complete(req("k1"))).toBe("hello");
  });

  it("throws when the recording is missing under MOCK=1", async () => {
    await expect(complete(req("absent"))).rejects.toThrow(/no recording for key/);
  });

  it("reports MOCK mode when MOCK=1", () => {
    expect(mode()).toBe("MOCK");
  });

  describe("live calls retry only transient failures", () => {
    const err = (status: number, message: string) => Object.assign(new Error(message), { status });
    const reply = (text: string) => ({ choices: [{ message: { content: text } }] });
    const make = (...outcomes: (Error | string)[]) => {
      let calls = 0;
      const client = {
        chat: {
          completions: {
            create: async () => {
              const o = outcomes[Math.min(calls++, outcomes.length - 1)];
              if (o instanceof Error) throw o;
              return reply(o);
            },
          },
        },
      };
      return { client, calls: () => calls };
    };
    const live = () => {
      delete process.env.MOCK;
    };
    const noWait = async () => {};

    it("retries a 429 and then returns the answer", async () => {
      live();
      const m = make(err(429, "rate limited"), "ok");
      expect(await complete(req("k"), { client: m.client as any, sleep: noWait })).toBe("ok");
      expect(m.calls()).toBe(2);
    });

    it("retries Groq's 'Failed to generate JSON' 400", async () => {
      live();
      const m = make(err(400, "Failed to generate JSON. Please adjust your prompt."), "{}");
      expect(await complete(req("k"), { client: m.client as any, sleep: noWait })).toBe("{}");
      expect(m.calls()).toBe(2);
    });

    it("retries a 5xx", async () => {
      live();
      const m = make(err(503, "unavailable"), "ok");
      expect(await complete(req("k"), { client: m.client as any, sleep: noWait })).toBe("ok");
    });

    it("does not retry an authentication error", async () => {
      live();
      const m = make(err(401, "invalid api key"), "ok");
      await expect(complete(req("k"), { client: m.client as any, sleep: noWait })).rejects.toThrow(/invalid api key/);
      expect(m.calls()).toBe(1);
    });

    it("does not retry any other 400", async () => {
      live();
      const m = make(err(400, "model not found"), "ok");
      await expect(complete(req("k"), { client: m.client as any, sleep: noWait })).rejects.toThrow(/model not found/);
      expect(m.calls()).toBe(1);
    });

    it("gives up after three attempts and reports the last error", async () => {
      live();
      const m = make(err(429, "first"), err(429, "second"), err(429, "third"), "never reached");
      await expect(complete(req("k"), { client: m.client as any, sleep: noWait })).rejects.toThrow(/third/);
      expect(m.calls()).toBe(3);
    });

    it("waits at least as long as the server's Retry-After asks", async () => {
      live();
      const waits: number[] = [];
      const m = make(Object.assign(err(429, "slow down"), { headers: { "retry-after": "3" } }), "ok");
      await complete(req("k"), { client: m.client as any, sleep: async (ms) => void waits.push(ms) });
      expect(waits).toEqual([3000]);
    });

    it("reads Retry-After from a Headers object too, and caps it at 30 seconds", async () => {
      live();
      const waits: number[] = [];
      const m = make(Object.assign(err(429, "slow down"), { headers: new Headers({ "retry-after": "999" }) }), "ok");
      await complete(req("k"), { client: m.client as any, sleep: async (ms) => void waits.push(ms) });
      expect(waits).toEqual([30_000]);
    });

    it("ignores a Retry-After it cannot read", async () => {
      live();
      const waits: number[] = [];
      const m = make(Object.assign(err(429, "slow down"), { headers: { "retry-after": "soon" } }), "ok");
      await complete(req("k"), { client: m.client as any, sleep: async (ms) => void waits.push(ms) });
      expect(waits).toEqual([1000]);
    });

    it("waits longer between each attempt", async () => {
      live();
      const waits: number[] = [];
      const m = make(err(429, "a"), err(429, "b"), "ok");
      await complete(req("k"), { client: m.client as any, sleep: async (ms) => void waits.push(ms) });
      expect(waits).toHaveLength(2);
      expect(waits[1]).toBeGreaterThan(waits[0]);
    });
  });

  describe("the output tap", () => {
    afterEach(() => setLlmTap(undefined));

    it("reports each answer with its role and recording key (MOCK)", async () => {
      fs.writeFileSync(path.join(dir, "k2.json"), JSON.stringify({ output: "hello" }));
      const seen: unknown[] = [];
      setLlmTap((e) => seen.push(e));
      await complete(req("k2"));
      expect(seen).toEqual([{ role: "planner", key: "k2", output: "hello" }]);
    });

    it("reports a live answer once, not the failed attempts before it", async () => {
      delete process.env.MOCK;
      let calls = 0;
      const client = {
        chat: {
          completions: {
            create: async () => {
              if (calls++ === 0) throw Object.assign(new Error("rate limited"), { status: 429 });
              return { choices: [{ message: { content: "live answer" } }] };
            },
          },
        },
      };
      const seen: any[] = [];
      setLlmTap((e) => seen.push(e));
      await complete(req("k3"), { client: client as any, sleep: async () => {} });
      expect(seen).toHaveLength(1);
      expect(seen[0].output).toBe("live answer");
    });

    it("stops reporting once it is cleared", async () => {
      fs.writeFileSync(path.join(dir, "k4.json"), JSON.stringify({ output: "x" }));
      const seen: unknown[] = [];
      setLlmTap((e) => seen.push(e));
      setLlmTap(undefined);
      await complete(req("k4"));
      expect(seen).toEqual([]);
    });
  });

  it("reads keys containing a colon from a filesystem-safe filename", async () => {
    fs.writeFileSync(path.join(dir, "extractor__abc.json"), JSON.stringify({ output: "x" }));
    expect(await complete(req("extractor:abc"))).toBe("x");
  });
});

describe("provider order and limits", () => {
  const ok = (text: string) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: text } }] }) } } });
  it("uses NEAR AI first when its key is set, then the LLM_* provider", async () => {
    const { providers } = await import("../src/llm");
    const list = providers({ NEAR_CLOUD_AI: "k", LLM_API_KEY: "g", LLM_BASE_URL: "https://g/v1", LLM_MODEL: "gm" } as any);
    expect(list.map((p) => p.name)).toEqual(["near-ai", "groq"]);
    expect(list[0].baseURL).toBe("https://cloud-api.near.ai/v1");
    expect(list[1].model).toBe("gm");
  });
  it("uses only LLM_* when there is no NEAR AI key", async () => {
    const { providers } = await import("../src/llm");
    expect(providers({ LLM_API_KEY: "g", LLM_MODEL: "gm" } as any).map((p) => p.name)).toEqual(["groq"]);
  });
  it("limits NEAR AI calls per hour", async () => {
    const { providers } = await import("../src/llm");
    expect(providers({ NEAR_CLOUD_AI: "k", NEAR_AI_MAX_PER_HOUR: "3" } as any)[0].maxPerHour).toBe(3);
  });
  it("still answers through an injected client", async () => {
    const was = process.env.MOCK;
    process.env.MOCK = "0";
    try {
      expect(await complete({ role: "planner", system: "s", user: "u", recordingKey: "k" }, { client: ok("fine") as any })).toBe("fine");
    } finally {
      process.env.MOCK = was;
    }
  });
});
