// Builds the site into the directory the tests serve, then runs Playwright. Same dir for both, so they cannot disagree.
import { spawnSync } from "node:child_process";

// NEXT_PUBLIC_* are fixed at build time: the test build swaps the real wallet for one a test can stand in for, and the RPC for a stub.
const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_WALLET_MOCK: "1", NEXT_PUBLIC_NEAR_RPC: "http://127.0.0.1:3300" };
const quote = (a) => (/^[\w./:=@-]+$/.test(a) ? a : JSON.stringify(a));
const run = (args) => spawnSync("npx", args.map(quote), { stdio: "inherit", env, shell: true }).status ?? 1;
if (run(["next", "build"]) !== 0) process.exit(1);
process.exit(run(["playwright", "test", ...process.argv.slice(2)]));
