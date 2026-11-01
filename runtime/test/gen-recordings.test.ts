import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRecordings } from "../../bench/gen-recordings";
import { loadAttempts } from "../../bench/redteam";
import { loadFixtures } from "../../bench/replay";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-gen-"));
  process.env.RECORDINGS_DIR = dir;
});
afterEach(() => {
  delete process.env.RECORDINGS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateRecordings", () => {
  it("writes one hand-authored recording per distinct model call for the real fixtures and attempts", async () => {
    const n = await generateRecordings(loadFixtures(), loadAttempts());
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(n);
    expect(n).toBeGreaterThan(20);
    for (const f of files) {
      expect(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).source).toBe("hand-authored");
    }
  });

  it("refuses two different outputs for the same model prompt instead of silently overwriting", async () => {
    const base = loadAttempts().find((a) => a.id === "R01")!;
    const clash = {
      ...base,
      id: "R99",
      model_outputs: { ...base.model_outputs, planner: { kind: "None", recipient: null, token: null, amount: null } },
    };
    await expect(generateRecordings([], [base, clash])).rejects.toThrow(/recording key collision/);
  });

  it("accepts the same output repeated for the same prompt", async () => {
    const base = loadAttempts().find((a) => a.id === "R01")!;
    await expect(generateRecordings([], [base, { ...base, id: "R98" }])).resolves.toBeGreaterThan(0);
  });

  it("restores the MOCK setting it changes", async () => {
    delete process.env.MOCK;
    await generateRecordings([], []);
    expect(process.env.MOCK).toBeUndefined();
  });
});
