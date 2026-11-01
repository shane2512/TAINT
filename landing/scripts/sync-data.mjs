// The pages read the repo's saved results at build time. A deploy from landing/ alone has no ../bench, so keep a copy
// here and refresh it on every build where ../bench exists.
import fs from "node:fs";
import path from "node:path";

const src = path.resolve("..", "bench");
if (!fs.existsSync(src)) process.exit(0);
const dst = path.resolve("data", "bench");
fs.rmSync(dst, { recursive: true, force: true });
for (const d of ["fixtures", "redteam", "results"]) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true });
fs.copyFileSync(path.join(src, "policy-cases.json"), path.join(dst, "policy-cases.json"));
