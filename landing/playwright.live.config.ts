import { defineConfig } from "@playwright/test";

// Opt-in. Needs the accounts in ../.env. The testnet project spends 0.001 testnet NEAR plus gas per run, and the
// live-model project uses the Groq quota. Run with: npm run test:e2e:live
process.env.NEXT_DIST_DIR = ".next-e2e";

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
  ],
  webServer: [
    { command: "npx tsx runtime/src/cosign-web.ts --propose", cwd: "..", url: "http://127.0.0.1:3222/meta", env: { PORT: "3222" }, timeout: 120_000, reuseExistingServer: false },
    { command: "npx next start -p 3122", url: "http://127.0.0.1:3122/", env: { RUNTIME_URL: "http://127.0.0.1:3222", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
    { command: "npx tsx runtime/src/server.ts --live-model", cwd: "..", url: "http://127.0.0.1:3223/meta", env: { PORT: "3223" }, reuseExistingServer: false },
    { command: "npx next start -p 3123", url: "http://127.0.0.1:3123/", env: { RUNTIME_URL: "http://127.0.0.1:3223", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
  ],
});
