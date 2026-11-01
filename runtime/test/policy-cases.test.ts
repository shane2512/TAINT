import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAmountYocto } from "../src/handles";
import { MockContract } from "../src/mock-contract";
import type { ArgProvenance, ProposalOutcome, Provenance, ProposedAction } from "../src/proposal";

// Runs bench/policy-cases.json, the rule table the Rust taint.near must also run.

interface Step {
  op: "remember" | "pin" | "unpin" | "registerPayee" | "advance" | "propose" | "cosign";
  [k: string]: any;
}
interface Table {
  config: { rememberCapNear: string; rememberTtlMs: number; payeeCooldownMs: number; payeeCooldownCapNear: string; globalCap24hNear: string };
  cases: { name: string; steps: Step[] }[];
}

const table: Table = JSON.parse(fs.readFileSync(path.join(__dirname, "../../bench/policy-cases.json"), "utf8"));
const near = (n: string): bigint => BigInt(parseAmountYocto(`${n} NEAR`)!);

const prov = (v: string | null | undefined): Provenance | null =>
  v === undefined || v === null ? null : v === "owner" ? { class: "Owner", source: "owner" } : { class: "Untrusted", source: v };

function run(steps: Step[]): void {
  let t = 1_000_000;
  const c = new MockContract({
    rememberCap: near(table.config.rememberCapNear),
    rememberTtlMs: table.config.rememberTtlMs,
    payeeCooldownMs: table.config.payeeCooldownMs,
    payeeCooldownCap: near(table.config.payeeCooldownCapNear),
    globalCap24h: near(table.config.globalCap24hNear),
    now: () => t,
  });
  const created = new Map<string, { id: number; hash: string }>();
  let n = 0;

  for (const s of steps) {
    if (s.op === "remember") c.remember(s.address, s.capNear ? near(s.capNear) : undefined, s.ttlMs);
    else if (s.op === "pin") c.pin(s.account);
    else if (s.op === "unpin") c.unpin(s.account);
    else if (s.op === "registerPayee") c.registerPayee(s.by, s.address);
    else if (s.op === "advance") t += s.ms;
    else if (s.op === "propose") {
      const a = s.action;
      const action: ProposedAction = {
        kind: a.kind,
        recipient: a.recipient ?? null,
        token: a.token ?? null,
        amount: a.amountYocto ?? near(a.amountNear).toString(),
      };
      const p: ArgProvenance = { recipient: prov(s.prov.recipient), token: prov(s.prov.token), amount: prov(s.prov.amount)! };
      const out: ProposalOutcome = c.propose(action, p, s.flow ?? `flow:${s.id}:${n++}`);
      check(out, s.expect, s.id);
      if ("Pending" in out) created.set(s.id, { id: out.Pending.proposal_id, hash: out.Pending.proposal_hash });
    } else if (s.op === "cosign") {
      const target = created.get(s.of)!;
      const hash = s.hash === "ok" ? target.hash : "wrong";
      if (s.expect.throws) expect(() => c.cosign(target.id, hash, s.remember)).toThrow(s.expect.throws);
      else check(c.cosign(target.id, hash, s.remember), s.expect, `cosign ${s.of}`);
    }
  }
}

function check(out: ProposalOutcome, expect_: any, label: string): void {
  if (expect_.Executed) expect(out, label).toHaveProperty("Executed");
  else if (expect_.Pending) {
    expect(out, label).toHaveProperty("Pending");
    expect((out as any).Pending.reasons, label).toEqual(expect_.Pending);
  } else expect(out, label).toEqual({ Rejected: { reason: expect_.Rejected } });
}

describe("shared policy rule table (bench/policy-cases.json)", () => {
  it("has the cases the Rust port must match", () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(15);
  });
  for (const c of table.cases) {
    it(c.name, () => run(c.steps));
  }
});
