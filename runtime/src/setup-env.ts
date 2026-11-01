// Builds .env from the key files `near account create-account ... save-to-legacy-keychain` left on this machine.
// The keys are copied file to file. Nothing secret is printed, returned in a message, or sent anywhere.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KeyPair } from "@near-js/crypto";

const ROLES = [
  { prefix: "taint", idVar: "TAINT_CONTRACT", keyVar: "TAINT_CONTRACT_PRIVATE_KEY" },
  { prefix: "mockdex", idVar: "MOCKDEX_CONTRACT", keyVar: "MOCKDEX_PRIVATE_KEY" },
  { prefix: "owner", idVar: "OWNER_ACCOUNT", keyVar: "OWNER_PRIVATE_KEY" },
  { prefix: "worker", idVar: "WORKER_ACCOUNT", keyVar: "WORKER_PRIVATE_KEY" },
  { prefix: "relayer", idVar: "RELAYER_ACCOUNT", keyVar: "RELAYER_PRIVATE_KEY" },
];

export interface SetupOptions {
  suffix: string;
  credentialsDir: string;
  templatePath: string;
  outPath: string;
  force: boolean;
}

export interface SetupResult {
  written: boolean;
  /** Account ids only. These are public. */
  accounts: string[];
  problems: string[];
}

type Cred = { ok: true; privateKey: string } | { ok: false; problem: string };

function readCredential(dir: string, account: string): Cred {
  let file: string | undefined = path.join(dir, `${account}.json`);
  if (!fs.existsSync(file)) {
    file = undefined;
    const folder = path.join(dir, account);
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      const first = fs.readdirSync(folder).filter((f) => f.endsWith(".json")).sort()[0];
      if (first) file = path.join(folder, first);
    }
  }
  if (!file) return { ok: false, problem: `${account}: no credentials file in ${dir}` };

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, problem: `${account}: the credentials file is not valid JSON` };
  }
  const secret = typeof json.private_key === "string" ? json.private_key : typeof json.secret_key === "string" ? json.secret_key : undefined;
  if (!secret) {
    // field NAMES only, never values
    return { ok: false, problem: `${account}: no private_key field in the credentials file (it has: ${Object.keys(json).join(", ") || "nothing"})` };
  }
  let kp: KeyPair;
  try {
    kp = KeyPair.fromString(secret as `ed25519:${string}`);
  } catch {
    return { ok: false, problem: `${account}: the private key in the credentials file is not a valid ed25519 key` };
  }
  if (typeof json.public_key === "string" && json.public_key !== kp.getPublicKey().toString()) {
    return { ok: false, problem: `${account}: the public key in the file does not match its private key` };
  }
  return { ok: true, privateKey: kp.toString() };
}

function setVar(text: string, name: string, value: string): string | undefined {
  const re = new RegExp(`^${name}=.*$`, "m");
  return re.test(text) ? text.replace(re, () => `${name}=${value}`) : undefined;
}

export function setupEnv(o: SetupOptions): SetupResult {
  const fail = (...problems: string[]): SetupResult => ({ written: false, accounts: [], problems });

  if (!/^[a-z0-9]([a-z0-9_-]{0,38}[a-z0-9])?$/.test(o.suffix)) {
    return fail("the suffix must be 1-40 lowercase letters, digits, '-' or '_' (it becomes part of the account ids)");
  }
  if (fs.existsSync(o.outPath) && !o.force) {
    return fail(`${o.outPath} already exists; pass --force to overwrite it (this replaces everything in it)`);
  }
  if (!fs.existsSync(o.templatePath)) return fail(`template ${o.templatePath} not found`);

  let text = fs.readFileSync(o.templatePath, "utf8");
  const accounts: string[] = [];
  const problems: string[] = [];
  for (const r of ROLES) {
    const account = `${r.prefix}-${o.suffix}.testnet`;
    const cred = readCredential(o.credentialsDir, account);
    if (!cred.ok) {
      problems.push(cred.problem);
      continue;
    }
    const withId = setVar(text, r.idVar, account);
    const withKey = withId && setVar(withId, r.keyVar, cred.privateKey);
    if (!withKey) {
      problems.push(`the template has no ${r.idVar} / ${r.keyVar} lines`);
      continue;
    }
    text = withKey;
    accounts.push(account);
  }
  if (problems.length) return { written: false, accounts: [], problems };

  fs.writeFileSync(o.outPath, text, { mode: 0o600 });
  return { written: true, accounts, problems: [] };
}

function main(): void {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const suffix = get("--suffix");
  if (!suffix) {
    console.error("usage: npm run setup:env -- --suffix <the suffix you used, e.g. myname> [--force] [--creds <dir>]");
    process.exit(2);
  }
  const r = setupEnv({
    suffix,
    credentialsDir: get("--creds") ?? path.join(os.homedir(), ".near-credentials", "testnet"),
    templatePath: ".env.example",
    outPath: ".env",
    force: args.includes("--force"),
  });
  if (!r.written) {
    for (const p of r.problems) console.error(`problem: ${p}`);
    process.exit(1);
  }
  console.log("wrote .env (git-ignored). Accounts filled in; keys were copied file to file and are not shown:");
  for (const a of r.accounts) console.log(`  ${a}`);
  console.log("\nNext: top up the contract account to 15 NEAR or more, then run: npm run check:env");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
