import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { complete, mode } from "../src/llm";

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

    it("waits longer between each attempt", async () => {
      live();
      const waits: number[] = [];
      const m = make(err(429, "a"), err(429, "b"), "ok");
      await complete(req("k"), { client: m.client as any, sleep: async (ms) => void waits.push(ms) });
      expect(waits).toHaveLength(2);
      expect(waits[1]).toBeGreaterThan(waits[0]);
    });
  });

  it("reads keys containing a colon from a filesystem-safe filename", async () => {
    fs.writeFileSync(path.join(dir, "extractor__abc.json"), JSON.stringify({ output: "x" }));
    expect(await complete(req("extractor:abc"))).toBe("x");
  });
});
