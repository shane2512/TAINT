import { describe, it, expect } from "vitest";
import { KeyPair } from "@near-js/crypto";
import { checkEnv, type Rpc } from "../src/check-env";

const NEAR = 10n ** 24n;
const ROLES = [
  { id: "TAINT_CONTRACT", key: "TAINT_CONTRACT_PRIVATE_KEY", acct: "taint-demo.testnet" },
  { id: "MOCKDEX_CONTRACT", key: "MOCKDEX_PRIVATE_KEY", acct: "mockdex-demo.testnet" },
  { id: "OWNER_ACCOUNT", key: "OWNER_PRIVATE_KEY", acct: "owner-demo.testnet" },
  { id: "WORKER_ACCOUNT", key: "WORKER_PRIVATE_KEY", acct: "worker-demo.testnet" },
  { id: "RELAYER_ACCOUNT", key: "RELAYER_PRIVATE_KEY", acct: "relayer-demo.testnet" },
];

interface Chain {
  [account: string]: { amount: bigint; keys: Record<string, "FullAccess" | "FunctionCall"> };
}

function world() {
  const env: Record<string, string> = {
    NEAR_NETWORK: "testnet",
    LLM_BASE_URL: "https://llm.example",
    LLM_API_KEY: "sk-test-secret",
    LLM_MODEL: "m",
  };
  const chain: Chain = {};
  const pairs: Record<string, KeyPair> = {};
  for (const r of ROLES) {
    const kp = KeyPair.fromRandom("ed25519");
    pairs[r.acct] = kp;
    env[r.id] = r.acct;
    env[r.key] = kp.toString();
    const big = r.id === "TAINT_CONTRACT" ? 20n : 5n;
    chain[r.acct] = { amount: big * NEAR, keys: { [kp.getPublicKey().toString()]: "FullAccess" } };
  }
  const rpc: Rpc = async (method, params: any) => {
    const acct = chain[params.account_id];
    if (!acct) throw new Error(`account ${params.account_id} does not exist`);
    if (params.request_type === "view_account") return { amount: acct.amount.toString() };
    const perm = acct.keys[params.public_key];
    if (!perm) throw new Error("access key does not exist");
    return { permission: perm === "FullAccess" ? "FullAccess" : { FunctionCall: { receiver_id: "x", method_names: [] } } };
  };
  return { env, chain, pairs, rpc };
}

const by = (checks: Awaited<ReturnType<typeof checkEnv>>, status: string) => checks.filter((c) => c.status === status);

describe("checkEnv", () => {
  it("passes a correctly set up testnet environment", async () => {
    const { env, rpc } = world();
    const checks = await checkEnv(env, rpc);
    expect(by(checks, "fail")).toEqual([]);
    expect(by(checks, "ok").length).toBeGreaterThan(10);
  });

  it("fails an account whose id variable is missing", async () => {
    const { env, rpc } = world();
    delete env.WORKER_ACCOUNT;
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "worker" && /WORKER_ACCOUNT/.test(c.detail))).toBe(true);
  });

  it("fails an account whose key variable is missing", async () => {
    const { env, rpc } = world();
    delete env.RELAYER_PRIVATE_KEY;
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "relayer" && /RELAYER_PRIVATE_KEY/.test(c.detail))).toBe(true);
  });

  it("fails a key that does not parse, without echoing it", async () => {
    const { env, rpc } = world();
    env.OWNER_PRIVATE_KEY = "ed25519:not-a-real-key-SECRETMARKER";
    const checks = await checkEnv(env, rpc);
    expect(by(checks, "fail").some((c) => c.name === "owner")).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("SECRETMARKER");
  });

  it("fails a key that is not on its account", async () => {
    const { env, rpc } = world();
    env.WORKER_PRIVATE_KEY = KeyPair.fromRandom("ed25519").toString();
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "worker" && /not on this account/.test(c.detail))).toBe(true);
  });

  it("fails an account that does not exist on chain", async () => {
    const { env, chain, rpc } = world();
    delete chain["mockdex-demo.testnet"];
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "mockdex" && /does not exist/.test(c.detail))).toBe(true);
  });

  it("warns, not fails, on a low balance and reports the balance", async () => {
    const { env, chain, rpc } = world();
    chain["taint-demo.testnet"].amount = 3n * NEAR;
    const checks = await checkEnv(env, rpc);
    expect(by(checks, "fail")).toEqual([]);
    const w = by(checks, "warn").find((c) => c.name === "contract")!;
    expect(w.detail).toMatch(/3(\.0+)? NEAR/);
  });

  it("requires a full-access key on the accounts that deploy or relay", async () => {
    const { env, chain, pairs, rpc } = world();
    chain["taint-demo.testnet"].keys[pairs["taint-demo.testnet"].getPublicKey().toString()] = "FunctionCall";
    chain["relayer-demo.testnet"].keys[pairs["relayer-demo.testnet"].getPublicKey().toString()] = "FunctionCall";
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "contract" && /full-access/.test(c.detail))).toBe(true);
    expect(fails.some((c) => c.name === "relayer" && /full-access/.test(c.detail))).toBe(true);
  });

  it("accepts a function-call key for the worker, and suggests one when the worker has full access", async () => {
    const { env, chain, pairs, rpc } = world();
    const warnsFull = by(await checkEnv(env, rpc), "warn");
    expect(warnsFull.some((c) => c.name === "worker" && /function-call/.test(c.detail))).toBe(true);
    chain["worker-demo.testnet"].keys[pairs["worker-demo.testnet"].getPublicKey().toString()] = "FunctionCall";
    const after = await checkEnv(env, rpc);
    expect(by(after, "fail")).toEqual([]);
    expect(by(after, "warn").some((c) => c.name === "worker" && /function-call/.test(c.detail))).toBe(false);
  });

  it("fails when two roles share an account", async () => {
    const { env, rpc } = world();
    env.WORKER_ACCOUNT = env.OWNER_ACCOUNT;
    env.WORKER_PRIVATE_KEY = env.OWNER_PRIVATE_KEY;
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => /same account/.test(c.detail))).toBe(true);
  });

  it("fails an account id that is not a testnet account while on testnet", async () => {
    const { env, rpc } = world();
    env.OWNER_ACCOUNT = "owner-demo.near";
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "owner" && /\.testnet/.test(c.detail))).toBe(true);
  });

  it("fails for any network other than testnet, because this check is testnet-only for now", async () => {
    const { env, rpc } = world();
    env.NEAR_NETWORK = "mainnet";
    const fails = by(await checkEnv(env, rpc), "fail");
    expect(fails.some((c) => c.name === "network")).toBe(true);
  });

  it("warns when the model settings are missing", async () => {
    const { env, rpc } = world();
    delete env.LLM_API_KEY;
    const checks = await checkEnv(env, rpc);
    expect(by(checks, "fail")).toEqual([]);
    expect(by(checks, "warn").some((c) => c.name === "model" && /LLM_API_KEY/.test(c.detail))).toBe(true);
  });

  it("never puts a private key or the model key in its output", async () => {
    const { env, rpc } = world();
    const out = JSON.stringify(await checkEnv(env, rpc));
    for (const r of ROLES) expect(out).not.toContain(env[r.key]);
    expect(out).not.toContain("sk-test-secret");
  });

  it("reports a network failure as a failure instead of throwing", async () => {
    const { env } = world();
    const down: Rpc = async () => {
      throw new Error("fetch failed");
    };
    const checks = await checkEnv(env, down);
    expect(by(checks, "fail").length).toBeGreaterThan(0);
  });
});
