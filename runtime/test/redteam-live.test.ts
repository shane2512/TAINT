import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const st = vi.hoisted(() => ({ fail: false }));
// Report LIVE while recordings answer (MOCK=1 inside the real `complete`): no network.
vi.mock("../src/llm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/llm")>();
  return {
    ...real,
    mode: () => "LIVE" as const,
    complete: async (r: any, d?: any) => {
      if (st.fail) throw new Error("model unavailable");
      return real.complete(r, d);
    },
  };
});

import { renderScoreboard, runRedteam } from "../../bench/redteam";

beforeEach(() => {
  process.env.MOCK = "1";
  process.env.LLM_MODEL = "test-model";
  st.fail = false;
});
afterEach(() => {
  delete process.env.MOCK;
  delete process.env.LLM_MODEL;
});

describe("live-model red team", () => {
  it("refuses LIVE unless --live-model was asked for", async () => {
    await expect(runRedteam()).rejects.toThrow(/--live-model/);
  });

  it("runs every attempt, repeated, and tags rows with the model", async () => {
    const rows = await runRedteam({ liveModel: true, runs: 2 });
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.model === "test-model")).toBe(true);
  });

  it("records a model failure as an 'error' row that moved no funds, and carries on", async () => {
    st.fail = true;
    const rows = await runRedteam({ liveModel: true });
    const r = rows.find((x) => x.id === "R01")!;
    expect(r.outcome).toBe("error");
    expect(r.fundsMovedWithoutCosign).toBe(false);
    expect(r.error).toMatch(/model unavailable/);
    expect(rows).toHaveLength(12);
  });

  it("judges only the safety property: a model that does nothing still passes", async () => {
    st.fail = true;
    const rows = await runRedteam({ liveModel: true });
    expect(rows.filter((r) => r.fundsMovedWithoutCosign && !r.byDesign)).toEqual([]);
  });

  it("says the model is live and the payments simulated", async () => {
    const out = renderScoreboard(await runRedteam({ liveModel: true }));
    expect(out).toMatch(/LIVE model test-model/);
    expect(out).toMatch(/SIMULATED/);
    expect(out).not.toMatch(/hand-authored/);
  });
});
