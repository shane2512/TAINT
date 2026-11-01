// Runs bench/policy-cases.json, the rule table the Rust taint.near must also run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAmountYocto } from "../runtime/src/handles";
import { MockContract } from "../runtime/src/mock-contract";
import type { ArgProvenance, ProposalOutcome, Provenance, ProposedAction } from "../runtime/src/proposal";

export interface Step {
  op: "remember" | "pin" | "unpin" | "registerPayee" | "advance" | "propose" | "cosign";
  [k: string]: any;
}
export interface Table {
  config: { rememberCapNear: string; rememberTtlMs: number; payeeCooldownMs: number; payeeCooldownCapNear: string; globalCap24hNear: string };
  cases: { name: string; steps: Step[] }[];
}

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "policy-cases.json");
export const loadTable = (): Table => JSON.parse(fs.readFileSync(file, "utf8"));

const near = (n: string): bigint => BigInt(parseAmountYocto(`${n} NEAR`)!);
const prov = (v: string | null | undefined): Provenance | null =>
  v === undefined || v === null ? null : v === "owner" ? { class: "Owner", source: "owner" } : { class: "Untrusted", source: v };

function mismatch(out: ProposalOutcome, want: any, label: string): string | null {
  const ok = want.Executed
    ? "Executed" in out
    : want.Pending
      ? "Pending" in out && JSON.stringify(out.Pending.reasons) === JSON.stringify(want.Pending)
      : "Rejected" in out && out.Rejected.reason === want.Rejected;
  return ok ? null : `${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(out)}`;
}

/** Every way the case differed from the table; an empty list is a pass. */
export function runCase(steps: Step[], config: Table["config"]): string[] {
  let t = 1_000_000;
  const c = new MockContract({
    rememberCap: near(config.rememberCapNear),
    rememberTtlMs: config.rememberTtlMs,
    payeeCooldownMs: config.payeeCooldownMs,
    payeeCooldownCap: near(config.payeeCooldownCapNear),
    globalCap24h: near(config.globalCap24hNear),
    now: () => t,
  });
  const created = new Map<string, { id: number; hash: string }>();
  const failures: string[] = [];
  const note = (m: string | null) => void (m && failures.push(m));
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
      const out = c.propose(action, p, s.flow ?? `flow:${s.id}:${n++}`);
      note(mismatch(out, s.expect, s.id));
      if ("Pending" in out) created.set(s.id, { id: out.Pending.proposal_id, hash: out.Pending.proposal_hash });
    } else if (s.op === "cosign") {
      const target = created.get(s.of)!;
      const hash = s.hash === "ok" ? target.hash : "wrong";
      try {
        const out = c.cosign(target.id, hash, s.remember);
        note(s.expect.throws ? `cosign ${s.of}: expected a throw matching ${s.expect.throws}` : mismatch(out, s.expect, `cosign ${s.of}`));
      } catch (e) {
        const msg = String((e as Error).message);
        if (!s.expect.throws) note(`cosign ${s.of}: threw ${msg}`);
        else if (!msg.includes(s.expect.throws)) note(`cosign ${s.of}: threw ${msg}, expected ${s.expect.throws}`);
      }
    }
  }
  return failures;
}
