import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ids = (s: string, re: RegExp) => [...new Set([...s.matchAll(re)].map((m) => m[1]))].sort();

test("docs/E2E-MAP.md and the test titles list the same features", () => {
  const dir = path.resolve("e2e");
  const specs = [...fs.readdirSync(dir), ...fs.readdirSync(path.join(dir, "live")).map((f) => `live/${f}`)].filter((f) => f.endsWith(".spec.ts"));
  const tagged = ids(specs.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n"), /\[(F\d\d)\]/g);
  const mapped = ids(fs.readFileSync(path.resolve("../docs/E2E-MAP.md"), "utf8"), /^\| (F\d\d) \|/gm);
  expect(mapped).toEqual(tagged);
});
