import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KeyPair } from "@near-js/crypto";
import { setupEnv } from "../src/setup-env";

const ROLE_PREFIXES = ["taint", "mockdex", "owner", "worker", "relayer"];
let dir: string;
let creds: string;
let template: string;
let out: string;
let keys: Record<string, KeyPair>;

function writeCreds(account: string, kp: KeyPair, over: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(creds, `${account}.json`),
    JSON.stringify({ account_id: account, public_key: kp.getPublicKey().toString(), private_key: kp.toString(), ...over }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "taint-setup-"));
  creds = path.join(dir, "creds");
  fs.mkdirSync(creds);
  template = path.join(dir, ".env.example");
  out = path.join(dir, ".env");
  fs.writeFileSync(
    template,
    [
      "# a comment",
      "MOCK=1",
      "TAINT_CONTRACT=",
      "TAINT_CONTRACT_PRIVATE_KEY=",
      "MOCKDEX_CONTRACT=",
      "MOCKDEX_PRIVATE_KEY=",
      "OWNER_ACCOUNT=",
      "OWNER_PRIVATE_KEY=",
      "WORKER_ACCOUNT=",
      "WORKER_PRIVATE_KEY=",
      "RELAYER_ACCOUNT=",
      "RELAYER_PRIVATE_KEY=",
      "LLM_API_KEY=",
      "",
    ].join("\n"),
  );
  keys = {};
  for (const p of ROLE_PREFIXES) {
    keys[p] = KeyPair.fromRandom("ed25519");
    writeCreds(`${p}-demo.testnet`, keys[p]);
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (over: Partial<Parameters<typeof setupEnv>[0]> = {}) =>
  setupEnv({ suffix: "demo", credentialsDir: creds, templatePath: template, outPath: out, force: false, ...over });

describe("setupEnv", () => {
  it("writes an .env with all five accounts and their keys", () => {
    const r = run();
    expect(r.problems).toEqual([]);
    expect(r.written).toBe(true);
    const text = fs.readFileSync(out, "utf8");
    expect(text).toContain("TAINT_CONTRACT=taint-demo.testnet");
    expect(text).toContain("MOCKDEX_CONTRACT=mockdex-demo.testnet");
    expect(text).toContain("OWNER_ACCOUNT=owner-demo.testnet");
    expect(text).toContain("WORKER_ACCOUNT=worker-demo.testnet");
    expect(text).toContain("RELAYER_ACCOUNT=relayer-demo.testnet");
    expect(text).toContain(`TAINT_CONTRACT_PRIVATE_KEY=${keys.taint.toString()}`);
    expect(text).toContain(`RELAYER_PRIVATE_KEY=${keys.relayer.toString()}`);
  });

  it("keeps the template's comments and unrelated lines", () => {
    run();
    const text = fs.readFileSync(out, "utf8");
    expect(text).toContain("# a comment");
    expect(text).toContain("MOCK=1");
    expect(text).toContain("LLM_API_KEY=\n");
  });

  it("reports the account ids it used but never a key", () => {
    const r = run();
    expect(r.accounts).toEqual(["taint-demo.testnet", "mockdex-demo.testnet", "owner-demo.testnet", "worker-demo.testnet", "relayer-demo.testnet"]);
    const shown = JSON.stringify(r);
    for (const p of ROLE_PREFIXES) expect(shown).not.toContain(keys[p].toString());
  });

  it("writes nothing and names the account when a credentials file is missing", () => {
    fs.rmSync(path.join(creds, "worker-demo.testnet.json"));
    const r = run();
    expect(r.written).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
    expect(r.problems.some((p) => p.includes("worker-demo.testnet"))).toBe(true);
  });

  it("falls back to the per-account folder layout", () => {
    fs.rmSync(path.join(creds, "owner-demo.testnet.json"));
    fs.mkdirSync(path.join(creds, "owner-demo.testnet"));
    fs.writeFileSync(
      path.join(creds, "owner-demo.testnet", `ed25519_${keys.owner.getPublicKey().toString().slice(8)}.json`),
      JSON.stringify({ public_key: keys.owner.getPublicKey().toString(), private_key: keys.owner.toString() }),
    );
    const r = run();
    expect(r.problems).toEqual([]);
    expect(fs.readFileSync(out, "utf8")).toContain(`OWNER_PRIVATE_KEY=${keys.owner.toString()}`);
  });

  it("refuses a file with no usable private key, naming the fields it found but not their values", () => {
    fs.writeFileSync(path.join(creds, "worker-demo.testnet.json"), JSON.stringify({ account_id: "worker-demo.testnet", seed_phrase: "SECRETWORDS here" }));
    const r = run();
    expect(r.written).toBe(false);
    const msg = r.problems.join(" ");
    expect(msg).toContain("worker-demo.testnet");
    expect(msg).toContain("seed_phrase");
    expect(msg).not.toContain("SECRETWORDS");
  });

  it("refuses a private key that does not parse, without echoing it", () => {
    writeCreds("worker-demo.testnet", keys.worker, { private_key: "ed25519:NOTAKEY-SECRETMARKER" });
    const r = run();
    expect(r.written).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRETMARKER");
  });

  it("refuses a file whose public key does not match its private key", () => {
    writeCreds("worker-demo.testnet", keys.worker, { public_key: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
    const r = run();
    expect(r.written).toBe(false);
    expect(r.problems.some((p) => /does not match/.test(p))).toBe(true);
  });

  it("will not overwrite an existing .env unless asked", () => {
    fs.writeFileSync(out, "KEEP=me\n");
    const r = run();
    expect(r.written).toBe(false);
    expect(r.problems.some((p) => /already exists/.test(p))).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toBe("KEEP=me\n");
    const forced = run({ force: true });
    expect(forced.written).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toContain("TAINT_CONTRACT=taint-demo.testnet");
  });

  it("rejects a suffix that could not be part of an account id", () => {
    for (const bad of ["", "My Name", "../x", "a.b", "UPPER"]) {
      const r = run({ suffix: bad });
      expect(r.written).toBe(false);
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });
});
