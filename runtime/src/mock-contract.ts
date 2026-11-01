import { createHash } from "node:crypto";
import bs58 from "bs58";
import type { ArgProvenance, ProposalOutcome, ProposedAction } from "./proposal";

/** Local stand-in for taint.near (MOCK=1). The Rust contract must implement the same rules. */

export interface MockConfig {
  rememberCap: bigint;
  rememberTtlMs: number;
  payeeCooldownMs: number;
  payeeCooldownCap: bigint;
  globalCap24h: bigint;
  now: () => number;
}

export interface BookEntry {
  address: string;
  cap: bigint;
  expiresAt: number;
  learnedFrom: string;
}

export interface PendingProposal {
  proposalId: number;
  proposalHash: string;
  action: ProposedAction;
  prov: ArgProvenance;
  flowHash: string;
  createdAt: number;
}

interface Record_ extends PendingProposal {
  status: "Pending" | "Executed";
}

const DAY = 24 * 60 * 60 * 1000;
const PENDING_TTL = 15 * 60 * 1000;
const U128_MAX = 2n ** 128n - 1n;

export class MockContract {
  private book = new Map<string, BookEntry>();
  private pins = new Set<string>();
  private payees = new Map<string, Map<string, number>>(); // address -> (registering account -> registeredAt)
  private seenFlows = new Set<string>();
  private records = new Map<number, Record_>();
  private spent: { ts: number; amt: bigint }[] = [];
  private nextId = 1;

  constructor(private cfg: MockConfig) {}

  remember(address: string, cap?: bigint, ttlMs?: number, learnedFrom = "owner"): void {
    this.book.set(address, {
      address,
      cap: cap ?? this.cfg.rememberCap,
      expiresAt: this.cfg.now() + (ttlMs ?? this.cfg.rememberTtlMs),
      learnedFrom,
    });
  }

  forget(address: string): void {
    this.book.delete(address);
  }

  pin(account: string): void {
    this.pins.add(account);
  }

  unpin(account: string): void {
    this.pins.delete(account);
  }

  registerPayee(by: string, address: string): void {
    const m = this.payees.get(address) ?? new Map<string, number>();
    m.set(by, this.cfg.now());
    this.payees.set(address, m);
  }

  getBook(): BookEntry[] {
    return [...this.book.values()];
  }

  /** Addresses the owner has approved or pinned accounts have vouched for; what a lookalike is compared against. */
  knownCounterparties(): string[] {
    const now = this.cfg.now();
    const out = new Set<string>();
    for (const e of this.book.values()) if (e.expiresAt > now) out.add(e.address);
    for (const [address, by] of this.payees) {
      for (const account of by.keys()) if (this.pins.has(account)) out.add(address);
    }
    return [...out];
  }

  getPending(): PendingProposal[] {
    const now = this.cfg.now();
    return [...this.records.values()]
      .filter((r) => r.status === "Pending" && now - r.createdAt <= PENDING_TTL)
      .map(({ status: _s, ...p }) => p);
  }

  spent24h(): bigint {
    const now = this.cfg.now();
    this.spent = this.spent.filter((s) => now - s.ts < DAY);
    return this.spent.reduce((a, s) => a + s.amt, 0n);
  }

  private bookCap(address: string): bigint | undefined {
    const e = this.book.get(address);
    return e && e.expiresAt > this.cfg.now() ? e.cap : undefined;
  }

  private payeeCap(address: string): bigint | undefined {
    const now = this.cfg.now();
    let best: bigint | undefined;
    for (const [by, at] of this.payees.get(address) ?? []) {
      if (!this.pins.has(by)) continue;
      const cap = now - at < this.cfg.payeeCooldownMs ? this.cfg.payeeCooldownCap : this.cfg.globalCap24h;
      if (best === undefined || cap > best) best = cap;
    }
    return best;
  }

  private coverage(address: string): bigint | undefined {
    const a = this.bookCap(address);
    const b = this.payeeCap(address);
    if (a === undefined) return b;
    if (b === undefined) return a;
    return a > b ? a : b;
  }

  private evaluate(action: ProposedAction, prov: ArgProvenance): { reject: string } | { pending: string[] } | "execute" {
    if (action.kind === "Transfer" && (!action.recipient || action.token)) return { reject: "malformed" };
    if (action.kind === "Swap" && (!action.token || action.recipient)) return { reject: "malformed" };
    const raw = BigInt(action.amount);
    if (raw <= 0n || raw > U128_MAX) return { reject: "malformed" }; // the Rust contract's amount is a u128
    const reasons: string[] = [];
    let cap: bigint | undefined;
    if (action.kind === "Transfer" && prov.recipient?.class === "Untrusted") {
      cap = this.coverage(action.recipient!);
      if (cap === undefined) reasons.push(`recipient from ${prov.recipient.source}`);
    }
    if (action.kind === "Swap" && prov.token?.class === "Untrusted") reasons.push(`token from ${prov.token.source}`);
    const amount = BigInt(action.amount);
    if (prov.amount.class === "Untrusted") {
      if (action.kind === "Swap" || cap === undefined || amount > cap) reasons.push(`amount from ${prov.amount.source}`);
    } else if (cap !== undefined && amount > cap) {
      reasons.push("amount above entry cap");
    }
    return reasons.length ? { pending: reasons } : "execute";
  }

  private hash(action: ProposedAction, prov: ArgProvenance, flowHash: string): string {
    return bs58.encode(createHash("sha256").update(JSON.stringify({ action, prov, flowHash })).digest());
  }

  private execute(id: number, amount: bigint): ProposalOutcome {
    if (this.spent24h() + amount > this.cfg.globalCap24h) return { Rejected: { reason: "global cap exceeded" } };
    this.spent.push({ ts: this.cfg.now(), amt: amount });
    return { Executed: { proposal_id: id } };
  }

  propose(action: ProposedAction, prov: ArgProvenance, flowHash: string): ProposalOutcome {
    if (this.seenFlows.has(flowHash)) return { Rejected: { reason: "duplicate flow_hash" } };
    this.seenFlows.add(flowHash);
    const d = this.evaluate(action, prov);
    if (d !== "execute" && "reject" in d) return { Rejected: { reason: d.reject } };
    const id = this.nextId++;
    if (d === "execute") {
      const out = this.execute(id, BigInt(action.amount));
      if ("Executed" in out) this.records.set(id, { proposalId: id, proposalHash: "", action, prov, flowHash, createdAt: this.cfg.now(), status: "Executed" });
      return out;
    }
    const proposalHash = this.hash(action, prov, flowHash);
    this.records.set(id, { proposalId: id, proposalHash, action, prov, flowHash, createdAt: this.cfg.now(), status: "Pending" });
    return { Pending: { proposal_id: id, proposal_hash: proposalHash, reasons: d.pending } };
  }

  cosign(proposalId: number, proposalHash: string, remember: boolean): ProposalOutcome {
    const rec = this.records.get(proposalId);
    if (!rec || rec.status !== "Pending") throw new Error("not pending");
    if (rec.proposalHash !== proposalHash) throw new Error("hash mismatch");
    if (this.cfg.now() - rec.createdAt > PENDING_TTL) throw new Error("expired");
    const out = this.execute(proposalId, BigInt(rec.action.amount));
    if (!("Executed" in out)) return out;
    rec.status = "Executed";
    if (remember && rec.action.recipient) {
      const prior = this.book.get(rec.action.recipient);
      this.remember(rec.action.recipient, undefined, undefined, rec.prov.recipient?.source ?? "owner");
      if (prior && prior.expiresAt > this.cfg.now()) {
        // approve-and-remember must never weaken an entry the owner already set
        const entry = this.book.get(rec.action.recipient)!;
        entry.cap = prior.cap > entry.cap ? prior.cap : entry.cap;
        entry.expiresAt = Math.max(prior.expiresAt, entry.expiresAt);
      }
    }
    return out;
  }
}

const NEAR = 10n ** 24n;

/** Defaults from the plan's Global Constraints. */
export function defaultMockConfig(now: () => number = Date.now): MockConfig {
  return {
    rememberCap: 1n * NEAR,
    rememberTtlMs: 30 * DAY,
    payeeCooldownMs: DAY,
    payeeCooldownCap: NEAR / 2n,
    globalCap24h: 5n * NEAR,
    now,
  };
}
