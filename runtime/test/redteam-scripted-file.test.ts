import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { runRedteam } from "../../bench/redteam";

describe("bench/results/redteam-scripted.json (shown on the site)", () => {
  beforeAll(() => {
    process.env.MOCK = "1";
  });
  it("is what the suite produces now", async () => {
    const saved = JSON.parse(fs.readFileSync("bench/results/redteam-scripted.json", "utf8")).rows;
    const rows = await runRedteam();
    expect(saved).toEqual(rows.map((r) => ({ id: r.id, outcome: r.outcome, fundsMovedWithoutCosign: r.fundsMovedWithoutCosign, byDesign: r.byDesign, matchesExpect: r.matchesExpect, paidTo: r.paidTo ?? null })));
  });
});
