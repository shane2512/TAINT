import { defineConfig } from "@playwright/test";

// Real browser, real Next.js production build, real runtime (MOCK=1). Nothing here touches a chain.
process.env.NEXT_DIST_DIR = ".next-e2e";

export default defineConfig({
  testDir: "e2e",
  testIgnore: "live/**",
  fullyParallel: false,
  workers: 1, // the specs share one runtime's state, in file order
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3110", viewport: { width: 1400, height: 800 } },
  webServer: [
    { command: "node e2e/stub-rpc.mjs", url: "http://127.0.0.1:3300/", reuseExistingServer: false },
    { command: "npx tsx runtime/src/server.ts", cwd: "..", url: "http://127.0.0.1:3210/meta", env: { MOCK: "1", PORT: "3210", ATTACK_RATE_LIMIT: "40", NEAR_RPC_URL: "http://127.0.0.1:3300", CHAIN_VIEW_CONTRACT: "taint-e2e.testnet", CHAIN_VIEW_OWNER: "owner-e2e.testnet" }, reuseExistingServer: false },
    { command: "npx next start -p 3110", url: "http://127.0.0.1:3110/", env: { RUNTIME_URL: "http://127.0.0.1:3210", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
    // The public-demo build: its own runtime, with free text off.
    { command: "npx tsx runtime/src/server.ts", cwd: "..", url: "http://127.0.0.1:3211/meta", env: { MOCK: "1", PORT: "3211", PUBLIC_DEMO: "1" }, reuseExistingServer: false },
    { command: "npx next start -p 3112", url: "http://127.0.0.1:3112/", env: { RUNTIME_URL: "http://127.0.0.1:3211", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
    // The same site with no runtime behind it.
    { command: "npx next start -p 3111", url: "http://127.0.0.1:3111/", env: { RUNTIME_URL: "http://127.0.0.1:3299", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
  ],
});
