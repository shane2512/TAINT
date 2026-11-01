import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const st = vi.hoisted(() => ({ failNaive: false, calls: 0 }));
// Report LIVE while the real recordings answer (MOCK=1 inside the real `complete`), so no network is touched.
vi.mock("../src/llm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/llm")>();
  return {
    ...real,
    mode: () => "LIVE" as const,
    complete: async (r: any, d?: any) => {
      st.calls++;
      if (st.failNaive && r.role === "naive") throw new Error("model unavailable");
      return real.complete(r, d);
    },
  };
});

import { label, renderTable, runReplay, saveResults } from "../../bench/replay";

beforeEach(() => {
  process.env.MOCK = "1";
  process.env.LLM_MODEL = "test-model";
  st.failNaive = false;
  st.calls = 0;
});
afterEach(() => {
  delete process.env.MOCK;
  delete process.env.LLM_MODEL;
});

describe("live-model replay", () => {
  it("refuses LIVE unless the live model was asked for, and says which flag", async () => {
    await expect(runReplay(["F1"], 1)).rejects.toThrow(/--live-model/);
  });

  it("labels an agent that decided nothing 'no-action', never 'blocked'", () => {
    expect(label("attack", "none")).toBe("no-action");
    expect(label("attack", "blocked")).toBe("blocked");
  });

  it("runs every agent, tagging rows with the model and simulated execution", async () => {
    const rows = await runReplay(["F1"], 1, { liveModel: true });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.mode).toBe("LIVE");
      expect(r.model).toBe("test-model");
      expect(r.execution).toBe("simulated");
      expect(r.network).toBe("none");
    }
  });

  it("keeps the raw model outputs behind each row", async () => {
    const rows = await runReplay(["F1"], 1, { liveModel: true });
    const naive = rows.find((r) => r.agent === "naive")!;
    expect(naive.modelOutputs).toHaveLength(1);
    expect(naive.modelOutputs![0].role).toBe("naive");
    const taint = rows.find((r) => r.agent === "taint")!;
    expect(taint.modelOutputs!.some((o) => o.role === "planner")).toBe(true);
  });

  it("asks the model once for both baselines, so they judge the same decision", async () => {
    const rows = await runReplay(["F1"], 1, { liveModel: true });
    const naiveCalls = rows.filter((r) => r.agent !== "taint").flatMap((r) => r.modelOutputs ?? []);
    expect(naiveCalls.filter((o) => o.role === "naive")).toHaveLength(1);
    const allow = rows.find((r) => r.agent === "allowlist")!;
    expect(allow.modelOutputs).toEqual([]); // it reused the naive agent's answer
  });

  it("records a model failure as an 'error' row and carries on with the other agents", async () => {
    st.failNaive = true;
    const rows = await runReplay(["F1"], 1, { liveModel: true });
    const naive = rows.find((r) => r.agent === "naive")!;
    expect(naive.outcome).toBe("error");
    expect(naive.error).toMatch(/model unavailable/);
    expect(naive.matchesExpect).toBe(false);
    expect(rows.find((r) => r.agent === "taint")!.outcome).toBe("pending");
  });

  it("states in the table that the model is live and the payments simulated", async () => {
    const table = renderTable(await runReplay(["F1"], 2, { liveModel: true }));
    expect(table).toMatch(/LIVE model test-model/);
    expect(table).toMatch(/SIMULATED/);
    expect(table).not.toMatch(/hand-authored/);
  });

  it("shows how many runs matched the expectation as k/N", async () => {
    const table = renderTable(await runReplay(["F1"], 3, { liveModel: true }));
    expect(table).toMatch(/\b3\/3\b/);
  });

  it("saves the rows as JSON and a markdown table, with the raw outputs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-res-"));
    try {
      const rows = await runReplay(["F1"], 1, { liveModel: true });
      const files = saveResults(rows, dir, new Date("2026-11-01T10:00:00Z"));
      expect(files.json).toContain("2026-11-01");
      const saved = JSON.parse(fs.readFileSync(files.json, "utf8"));
      expect(saved.rows).toHaveLength(3);
      expect(saved.rows[0].modelOutputs).toBeDefined();
      expect(saved.model).toBe("test-model");
      expect(fs.readFileSync(files.md, "utf8")).toMatch(/LIVE model test-model/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
