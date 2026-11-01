import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadAttempts, renderScoreboard, runRedteam, type RedteamRow } from "../../bench/redteam";

beforeEach(() => {
  process.env.MOCK = "1";
});
afterEach(() => {
  delete process.env.MOCK;
});

describe("redteam (MOCK, with the extractor and planner assumed fully fooled)", () => {
  it("runs twelve attempts", async () => {
    expect(loadAttempts()).toHaveLength(12);
    expect(await runRedteam()).toHaveLength(12);
  });

  it("moves no funds without a co-sign, except the two by-design cases", async () => {
    const rows = await runRedteam();
    const moved = rows.filter((r) => r.fundsMovedWithoutCosign);
    expect(moved.map((r) => r.id)).toEqual(["R07", "R12"]);
    expect(moved.every((r) => r.byDesign)).toBe(true);
  });

  it("matches every attempt's declared expectation", async () => {
    const rows = await runRedteam();
    expect(rows.filter((r) => !r.matchesExpect).map((r) => r.id)).toEqual([]);
  });

  it("holds attacker-chosen values for co-sign instead of executing them", async () => {
    const rows = await runRedteam();
    for (const id of ["R01", "R02", "R05", "R06", "R08", "R11"]) {
      expect(rows.find((r) => r.id === id)!.outcome).toBe("pending");
    }
  });

  it("refuses invalid values and ungrounded literals before they reach the contract", async () => {
    const rows = await runRedteam();
    for (const id of ["R03", "R04", "R09"]) {
      expect(rows.find((r) => r.id === id)!.outcome).toBe("none");
    }
  });

  it("refuses an over-long instruction at signing time", async () => {
    const r = (await runRedteam()).find((x) => x.id === "R10")!;
    expect(r.outcome).toBe("refused-at-signing");
    expect(r.fundsMovedWithoutCosign).toBe(false);
  });

  it("gives every attempt a technique and a note", async () => {
    for (const r of await runRedteam()) {
      expect(r.technique.length).toBeGreaterThan(3);
      expect(r.note.length).toBeGreaterThan(3);
    }
  });
});

describe("scoreboard", () => {
  const row = (over: Partial<RedteamRow>): RedteamRow => ({
    id: "X",
    technique: "t",
    note: "n",
    outcome: "pending",
    fundsMovedWithoutCosign: false,
    byDesign: false,
    matchesExpect: true,
    ...over,
  });

  it("states the counts and the mode", () => {
    const s = renderScoreboard([row({ id: "A" }), row({ id: "B", outcome: "executed", fundsMovedWithoutCosign: true, byDesign: true })]);
    expect(s).toContain("attempts: 2");
    expect(s).toContain("moved by design: 1");
    expect(s).toContain("failures: 0");
    expect(s).toContain("hand-authored");
  });

  it("lists a failure prominently when funds move without co-sign and not by design", () => {
    const s = renderScoreboard([row({ id: "Z", outcome: "executed", fundsMovedWithoutCosign: true })]);
    expect(s).toContain("failures: 1");
    expect(s).toContain("FAILURE: Z");
  });
});
