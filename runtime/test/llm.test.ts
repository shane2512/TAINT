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

  it("reads keys containing a colon from a filesystem-safe filename", async () => {
    fs.writeFileSync(path.join(dir, "extractor__abc.json"), JSON.stringify({ output: "x" }));
    expect(await complete(req("extractor:abc"))).toBe("x");
  });
});
