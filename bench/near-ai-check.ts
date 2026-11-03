// Free (no credits): fetch NEAR AI Cloud's live attestation report for a model and run our checks on it.
//   npm run near-ai-check -- [model]      needs NEAR_CLOUD_AI (or LLM_API_KEY) in .env
import { randomBytes } from "node:crypto";
import { checkReport } from "../runtime/src/near-ai-verify";

const key = process.env.NEAR_CLOUD_AI ?? process.env.LLM_API_KEY;
const model = process.argv[2] ?? "Qwen/Qwen3.6-35B-A3B-FP8";
if (!key) throw new Error("set NEAR_CLOUD_AI in .env");
const nonce = randomBytes(32).toString("hex");
const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`, {
  headers: { Authorization: `Bearer ${key}` },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const out = checkReport(await res.json(), nonce, model);
console.log(`[near-ai-check] model=${model} nonce-bound=${out.ok} quoteChainVerified=${out.quoteChainVerified}`);
for (const e of out.errors) console.log("  FAIL:", e);
process.exitCode = out.ok ? 0 : 1;
