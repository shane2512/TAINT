import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadFixtures, renderTable, runReplay } from "../../bench/replay";

const root = path.join(__dirname, "../..");

beforeEach(() => {
  process.env.MOCK = "1";
});
afterEach(() => {
  delete process.env.MOCK;
});

describe("replay (MOCK)", () => {
  it("runs F1, F3, L1, L2 across three agents and every row matches its expectation", async () => {
    const rows = await runReplay(["F1", "F3", "L1", "L2"], 1);
    expect(rows).toHaveLength(12);
    const wrong = rows.filter((r) => !r.matchesExpect).map((r) => `${r.fixture}/${r.agent}: ${r.outcome} (want ${r.expected})`);
    expect(wrong).toEqual([]);
  });

  it("labels every row with its network and mode", async () => {
    const rows = await runReplay(["F1", "L1"], 1);
    for (const r of rows) {
      expect(r.network).toBeTruthy();
      expect(r.mode).toBe("MOCK");
    }
  });

  it("drains the naive agent and holds TAINT on F1 and F3", async () => {
    const rows = await runReplay(["F1", "F3"], 1);
    const get = (f: string, a: string) => rows.find((r) => r.fixture === f && r.agent === a)!;
    expect(get("F1", "naive").outcome).toBe("drained");
    expect(get("F1", "allowlist").outcome).toBe("blocked");
    expect(get("F1", "taint").outcome).toBe("pending");
    expect(get("F3", "naive").outcome).toBe("drained");
    expect(get("F3", "taint").outcome).toBe("pending");
  });

  it("lets TAINT complete the legitimate tasks the allowlist blocks (L1, L2)", async () => {
    const rows = await runReplay(["L1", "L2"], 1);
    const get = (f: string, a: string) => rows.find((r) => r.fixture === f && r.agent === a)!;
    expect(get("L1", "taint").outcome).toBe("ok");
    expect(get("L2", "taint").outcome).toBe("ok");
    expect(get("L1", "allowlist").outcome).toBe("blocked");
    expect(get("L2", "allowlist").outcome).toBe("blocked");
  });

  it("prints the banner first and the provenance path of every held TAINT row", async () => {
    const rows = await runReplay(["F1"], 1);
    const table = renderTable(rows);
    expect(table.split("\n")[0]).toContain("mode=MOCK");
    expect(table).toContain("recipient <- x.com/@attacker");
  });

  it("says in MOCK mode that the model outputs are hand-authored, so the table is plumbing, not model behaviour", async () => {
    const table = renderTable(await runReplay(["F1"], 1));
    expect(table).toMatch(/hand-authored/);
    expect(table.split("\n")[1]).toContain("not model behaviour");
  });

  it("aggregates repeated runs into counts", async () => {
    const table = renderTable(await runReplay(["F1"], 3));
    expect(table).toContain("drained 3/3");
  });

  it("refuses to run LIVE unless --live-model was asked for", async () => {
    delete process.env.MOCK;
    await expect(runReplay(["F1"], 1)).rejects.toThrow(/--live-model/);
  });
});

describe("fixtures and recordings", () => {
  it("cites its sources for the real-incident fixtures", () => {
    const fx = loadFixtures();
    for (const id of ["F1", "F3"]) expect(fx.find((f) => f.id === id)!.source_urls.length).toBeGreaterThan(0);
  });

  it("labels every committed recording as hand-authored or recorded", () => {
    const dir = path.join(root, "bench/recordings");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      expect(["hand-authored", "recorded"]).toContain(j.source);
    }
  });
});
