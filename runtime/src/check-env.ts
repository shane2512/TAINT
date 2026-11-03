// Checks a filled-in .env against the live testnet before anything is deployed.
// It prints account ids, public-key prefixes and balances. It never prints a private key or the model key.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export type Rpc = (method: string, params: Record<string, unknown>) => Promise<any>;

interface Role {
  name: string;
  idVar: string;
  keyVar: string;
  minNear: number;
  /** full: deploys or relays, so needs a full-access key. any: either kind works. */
  needs: "full" | "any" | "prefer-function-call";
}

const ROLES: Role[] = [
  { name: "contract", idVar: "TAINT_CONTRACT", keyVar: "TAINT_CONTRACT_PRIVATE_KEY", minNear: 15, needs: "full" },
  { name: "mockdex", idVar: "MOCKDEX_CONTRACT", keyVar: "MOCKDEX_PRIVATE_KEY", minNear: 3, needs: "full" },
  { name: "owner", idVar: "OWNER_ACCOUNT", keyVar: "OWNER_PRIVATE_KEY", minNear: 0.5, needs: "any" },
  { name: "worker", idVar: "WORKER_ACCOUNT", keyVar: "WORKER_PRIVATE_KEY", minNear: 1, needs: "prefer-function-call" },
  { name: "relayer", idVar: "RELAYER_ACCOUNT", keyVar: "RELAYER_PRIVATE_KEY", minNear: 2, needs: "full" },
];

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const YOCTO = 10n ** 24n;

const fmtNear = (yocto: bigint): string => {
  const whole = yocto / YOCTO;
  const cents = ((yocto % YOCTO) * 100n) / YOCTO;
  return cents === 0n ? `${whole}` : `${whole}.${cents.toString().padStart(2, "0")}`;
};

export async function checkEnv(env: Record<string, string | undefined>, rpc: Rpc): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) => out.push({ name, status, detail });

  const network = env.NEAR_NETWORK;
  if (network !== undefined && network !== "testnet") {
    add("network", "fail", `NEAR_NETWORK=${network}, but this check only supports testnet for now`);
    return out;
  }
  add("network", network === undefined ? "warn" : "ok", network === undefined ? "NEAR_NETWORK is not set; assuming testnet" : "testnet");

  const seen = new Map<string, string>();
  for (const r of ROLES) {
    const id = env[r.idVar];
    if (!id) {
      add(r.name, "fail", `set ${r.idVar}`);
      continue;
    }
    if (id.length < 2 || id.length > 64 || !ACCOUNT_RE.test(id.replace(/\.testnet$/, ""))) {
      add(r.name, "fail", `${r.idVar} is not a valid account id`);
      continue;
    }
    if (!id.endsWith(".testnet")) {
      add(r.name, "fail", `${id} is not a .testnet account`);
      continue;
    }
    const clash = seen.get(id);
    if (clash) {
      add("accounts", "fail", `${clash} and ${r.name} use the same account (${id}); each role needs its own`);
      continue;
    }
    seen.set(id, r.name);
    add(r.name, "ok", `account id ${id} is valid`);

    const secret = env[r.keyVar];
    if (!secret) {
      add(r.name, "fail", `set ${r.keyVar}`);
      continue;
    }
    let publicKey: string;
    try {
      publicKey = KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
    } catch {
      add(r.name, "fail", `${r.keyVar} is not a valid ed25519:... key`); // never echo the value
      continue;
    }
    add(r.name, "ok", `${r.keyVar} parses`);

    let amount: bigint;
    try {
      amount = BigInt((await rpc("query", { request_type: "view_account", finality: "final", account_id: id })).amount);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      add(r.name, "fail", /does not exist/.test(msg) ? `account ${id} does not exist on testnet` : `could not reach testnet: ${msg}`);
      continue;
    }
    if (amount < BigInt(Math.round(r.minNear * 1000)) * (YOCTO / 1000n)) {
      add(r.name, "warn", `${id} has ${fmtNear(amount)} NEAR; ${r.minNear} NEAR or more is recommended`);
    } else {
      add(r.name, "ok", `${id} has ${fmtNear(amount)} NEAR`);
    }

    let full: boolean;
    try {
      const key = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: id, public_key: publicKey });
      full = key.permission === "FullAccess";
    } catch {
      add(r.name, "fail", `the key in ${r.keyVar} (${publicKey.slice(0, 16)}...) is not on this account`);
      continue;
    }
    if (r.needs === "full" && !full) {
      add(r.name, "fail", `${r.name} needs a full-access key, but the key in ${r.keyVar} is function-call only`);
    } else if (r.needs === "prefer-function-call" && full) {
      add(r.name, "warn", `the ${r.name} key has full access; a function-call key limited to the contract is safer if it leaks`);
    } else {
      add(r.name, "ok", `key ${publicKey.slice(0, 16)}... is on the account (${full ? "full access" : "function call"})`);
    }
  }
  if (!out.some((c) => c.name === "accounts")) add("accounts", "ok", "each role uses its own account");

  const missing = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].filter((v) => !env[v]);
  add("model", missing.length ? "warn" : "ok", missing.length ? `set ${missing.join(", ")} for the live model runs` : "model settings are present");
  return out;
}

export function jsonRpc(url = "https://test.rpc.fastnear.com"): Rpc {
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "check-env", method, params }),
    });
    const body = (await res.json()) as any;
    if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? "rpc error");
    if (body.result?.error) throw new Error(String(body.result.error));
    return body.result;
  };
}

async function main(): Promise<void> {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  else console.log("no .env file here; copy .env.example to .env and fill it in");
  const checks = await checkEnv(process.env, jsonRpc());
  const tag = { ok: "[ ok ]", warn: "[WARN]", fail: "[FAIL]" } as const;
  for (const c of checks) console.log(`${tag[c.status]} ${c.name}: ${c.detail}`);
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  console.log(`\n${fails} failed, ${warns} warnings, ${checks.length - fails - warns} ok`);
  if (fails) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String((e as Error).message ?? e));
    process.exit(1);
  });
}
