import { defineConfig } from "@playwright/test";

// Opt-in. Needs the accounts in ../.env. The testnet project spends 0.001 testnet NEAR plus gas per run, and the
// live-model project uses the Groq quota. Run with: npm run test:e2e:live
process.env.NEXT_DIST_DIR = ".next-e2e";
import fs from "node:fs";
if (fs.existsSync("../.env")) process.loadEnvFile("../.env");

export default defineConfig({
  testDir: "e2e/live",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  reporter: [["list"]],
  use: { viewport: { width: 1400, height: 800 } },
  projects: [
    { name: "testnet", testMatch: "testnet.spec.ts", use: { baseURL: "http://127.0.0.1:3122" } },
    { name: "live-model", testMatch: "live-model.spec.ts", use: { baseURL: "http://127.0.0.1:3123" } },
    { name: "livesite", testMatch: "live-site.spec.ts", use: { baseURL: "http://127.0.0.1:3124" } },
  ],
  webServer: [
    { command: "npx tsx runtime/src/cosign-web.ts --propose", cwd: "..", url: "http://127.0.0.1:3222/meta", env: { PORT: "3222" }, timeout: 120_000, reuseExistingServer: false },
    { command: "npx next start -p 3122", url: "http://127.0.0.1:3122/", env: { RUNTIME_URL: "http://127.0.0.1:3222", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
    { command: "npx tsx runtime/src/server.ts --live-model", cwd: "..", url: "http://127.0.0.1:3223/meta", env: { PORT: "3223" }, reuseExistingServer: false },
    { command: "npx next start -p 3123", url: "http://127.0.0.1:3123/", env: { RUNTIME_URL: "http://127.0.0.1:3223", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
    // The public site as it is deployed: LIVE_CHAIN, the real contract and a real model. NEAR AI credits are off here.
    { command: "npx tsx runtime/src/server.ts", cwd: "..", url: "http://127.0.0.1:3224/meta", env: { LIVE_CHAIN: "1", PORT: "3224", NEAR_CLOUD_AI: "", NEAR_AI_API_KEY: "" }, timeout: 120_000, reuseExistingServer: false },
    { command: "npx next start -p 3124", url: "http://127.0.0.1:3124/", env: { RUNTIME_URL: "http://127.0.0.1:3224", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
  ],
});
