// ONE real completion on NEAR AI Cloud (costs a fraction of a cent), verified end to end with our client.
//   npm run near-ai-signed -- [model]      needs NEAR_CLOUD_AI in .env and credits
import { randomBytes } from "node:crypto";
import { verifiedChat } from "../runtime/src/near-ai-verify";

const key = process.env.NEAR_CLOUD_AI;
const model = process.argv[2] ?? "Qwen/Qwen3.6-35B-A3B-FP8";
if (!key) throw new Error("set NEAR_CLOUD_AI in .env");
const r = await verifiedChat({
  baseUrl: "https://cloud-api.near.ai/v1", apiKey: key, model, nonceHex: randomBytes(32).toString("hex"),
  messages: [{ role: "user", content: "Reply with the single word: ok" }], extra: { max_tokens: 16, stream: false },
});
console.log(`[near-ai-signed] model=${model} chatId=${r.chatId} reply=${JSON.stringify(r.content)}`);
console.log(`  report bound to our nonce: ${r.preflight.ok}${r.preflight.errors.map((e) => "\n    FAIL: " + e).join("")}`);
console.log(`  response signature valid:  ${r.signature.ok}${r.signature.errors.map((e) => "\n    FAIL: " + e).join("")}`);
console.log(`  Intel quote chain verified: false (not built)`);
process.exitCode = r.preflight.ok && r.signature.ok ? 0 : 1;
