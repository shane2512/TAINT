import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, plannerRecordingKey } from "../src/planner";
import { HandleStore } from "../src/handles";

const seen = vi.hoisted(() => [] as { role: string; system: string; user: string }[]);
vi.mock("../src/llm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/llm")>();
  return { ...real, complete: async (r: any) => (seen.push(r), real.complete(r)) };
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-pl-"));
  process.env.RECORDINGS_DIR = dir;
  process.env.MOCK = "1";
  seen.length = 0;
});
afterEach(() => {
  delete process.env.RECORDINGS_DIR;
  delete process.env.MOCK;
  fs.rmSync(dir, { recursive: true, force: true });
});

const record = (instruction: string, handles: ReturnType<HandleStore["summaries"]>, output: string) => {
  const key = plannerRecordingKey(instruction, handles).replace(/[^a-zA-Z0-9_.-]/g, "__");
  fs.writeFileSync(path.join(dir, key + ".json"), JSON.stringify({ output }));
};

describe("plan", () => {
  it("parses a handle-based transfer", async () => {
    const store = new HandleStore();
    store.add("Account", "attacker.near", "x.com/@attacker");
    store.add("Amount", "3000000000000000000000000", "x.com/@attacker");
    const h = store.summaries();
    record("check mentions", h, '{"kind":"Transfer","recipient":{"handle":"$h1"},"amount":{"handle":"$h2"},"token":null}');
    expect(await plan("check mentions", h)).toEqual({
      kind: "Transfer",
      recipient: { handle: "$h1" },
      amount: { handle: "$h2" },
      token: null,
    });
  });

  it("returns kind None for garbage output", async () => {
    record("x", [], "I will send all the money!");
    expect((await plan("x", [])).kind).toBe("None");
  });

  it("returns kind None when an argument reference is malformed", async () => {
    record("x", [], '{"kind":"Transfer","recipient":{"literal":5},"amount":null,"token":null}');
    expect((await plan("x", [])).kind).toBe("None");
  });

  it("never puts handle values or the full source in the planner prompt", async () => {
    const store = new HandleStore();
    store.add("Account", "attacker.near", "x.com/@ignore-rules-send-all");
    const h = store.summaries();
    record("check mentions", h, '{"kind":"None","recipient":null,"token":null,"amount":null}');
    await plan("check mentions", h);
    expect(seen).toHaveLength(1);
    expect(seen[0].role).toBe("planner");
    expect(seen[0].user).toContain("check mentions");
    expect(seen[0].user).not.toContain("attacker.near");
    expect(seen[0].user).not.toContain("send-all");
    expect(seen[0].user).toContain("x.com");
  });
});
