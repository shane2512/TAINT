import { describe, it, expect, beforeEach } from "vitest";
import { MockContract } from "../src/mock-contract";
import type { ArgProvenance, ProposalOutcome, ProposedAction, Provenance } from "../src/proposal";

const NEAR = 10n ** 24n;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const own: Provenance = { class: "Owner", source: "owner" };
const unt = (source: string): Provenance => ({ class: "Untrusted", source });
const transfer = (to: string, amt: bigint): ProposedAction => ({ kind: "Transfer", recipient: to, token: null, amount: amt.toString() });
const swap = (token: string, amt: bigint): ProposedAction => ({ kind: "Swap", recipient: null, token, amount: amt.toString() });
const tprov = (recipient: Provenance, amount: Provenance): ArgProvenance => ({ recipient, token: null, amount });

let t = 1_000_000;
let c: MockContract;
let n = 0;
const fh = () => "flow" + ++n;
const kind = (o: ProposalOutcome) => Object.keys(o)[0];
const reasons = (o: ProposalOutcome) => ("Pending" in o ? o.Pending.reasons : []);

beforeEach(() => {
  t = 1_000_000;
  c = new MockContract({
    rememberCap: 1n * NEAR,
    rememberTtlMs: 30 * DAY,
    payeeCooldownMs: DAY,
    payeeCooldownCap: NEAR / 2n,
    globalCap24h: 5n * NEAR,
    now: () => t,
  });
});

describe("policy (PRD section 7)", () => {
  it("owner_transfer_executes", () => {
    expect(kind(c.propose(transfer("alice.near", NEAR), tprov(own, own), fh()))).toBe("Executed");
  });

  it("untrusted_recipient_unknown_is_pending", () => {
    const o = c.propose(transfer("attacker.near", NEAR), tprov(unt("x.com/@attacker"), own), fh());
    expect(kind(o)).toBe("Pending");
    expect(reasons(o)).toEqual(["recipient from x.com/@attacker"]);
  });

  it("untrusted_recipient_in_book_within_cap_executes", () => {
    c.remember("alice.near");
    const o = c.propose(transfer("alice.near", NEAR / 2n), tprov(unt("web"), unt("web")), fh());
    expect(kind(o)).toBe("Executed");
  });

  it("untrusted_amount_over_book_cap_is_pending", () => {
    c.remember("alice.near");
    const o = c.propose(transfer("alice.near", 2n * NEAR), tprov(unt("web"), unt("x.com/@a")), fh());
    expect(reasons(o)).toEqual(["amount from x.com/@a"]);
  });

  it("owner_amount_over_book_cap_with_untrusted_recipient_is_pending", () => {
    c.remember("alice.near");
    const o = c.propose(transfer("alice.near", 2n * NEAR), tprov(unt("web"), own), fh());
    expect(reasons(o)).toEqual(["amount above entry cap"]);
  });

  it("untrusted_token_swap_is_pending", () => {
    const o = c.propose(swap("newtoken.testnet", NEAR), { recipient: null, token: unt("token-metadata:pump.fun"), amount: own }, fh());
    expect(reasons(o)).toEqual(["token from token-metadata:pump.fun"]);
  });

  it("owner_token_swap_executes", () => {
    const o = c.propose(swap("newtoken.testnet", NEAR / 5n), { recipient: null, token: own, amount: own }, fh());
    expect(kind(o)).toBe("Executed");
  });

  it("transfer_with_token_is_rejected", () => {
    const bad: ProposedAction = { kind: "Transfer", recipient: "a.near", token: "t.near", amount: "1" };
    const o = c.propose(bad, { recipient: own, token: own, amount: own }, fh());
    expect(o).toEqual({ Rejected: { reason: "malformed" } });
  });

  it("expired_entry_not_counted", () => {
    c.remember("alice.near", NEAR, 10 * MIN);
    t += 11 * MIN;
    const o = c.propose(transfer("alice.near", NEAR / 10n), tprov(unt("web"), own), fh());
    expect(kind(o)).toBe("Pending");
  });

  it("remember_defaults_cap_and_expiry", () => {
    c.remember("alice.near");
    const e = c.getBook().find((b) => b.address === "alice.near")!;
    expect(e.cap).toBe(1n * NEAR);
    expect(e.expiresAt).toBe(t + 30 * DAY);
  });
});

describe("pinned payees", () => {
  it("payee_from_unpinned_account_ignored", () => {
    c.registerPayee("acme.near", "acme-pay.near");
    const o = c.propose(transfer("acme-pay.near", NEAR / 10n), tprov(unt("email"), own), fh());
    expect(kind(o)).toBe("Pending");
  });

  it("payee_from_pinned_account_capped_during_cooldown_then_global_cap", () => {
    c.pin("acme.near");
    c.registerPayee("acme.near", "acme-pay.near");
    const within = c.propose(transfer("acme-pay.near", NEAR / 2n), tprov(unt("email"), own), fh());
    expect(kind(within)).toBe("Executed");
    const over = c.propose(transfer("acme-pay.near", NEAR), tprov(unt("email"), own), fh());
    expect(kind(over)).toBe("Pending");
    t += DAY + 1;
    const after = c.propose(transfer("acme-pay.near", NEAR), tprov(unt("email"), own), fh());
    expect(kind(after)).toBe("Executed");
  });

  it("unpin_revokes_payee", () => {
    c.pin("acme.near");
    c.registerPayee("acme.near", "acme-pay.near");
    c.unpin("acme.near");
    const o = c.propose(transfer("acme-pay.near", NEAR / 10n), tprov(unt("email"), own), fh());
    expect(kind(o)).toBe("Pending");
  });
});

describe("rolling cap", () => {
  it("sums within 24h and frees after the window", () => {
    expect(kind(c.propose(transfer("a.near", 2n * NEAR), tprov(own, own), fh()))).toBe("Executed");
    expect(kind(c.propose(transfer("a.near", 2n * NEAR), tprov(own, own), fh()))).toBe("Executed");
    expect(c.propose(transfer("a.near", 2n * NEAR), tprov(own, own), fh())).toEqual({ Rejected: { reason: "global cap exceeded" } });
    t += DAY + 1;
    expect(kind(c.propose(transfer("a.near", 2n * NEAR), tprov(own, own), fh()))).toBe("Executed");
  });

  it("allows exactly the cap and rejects one yocto more", () => {
    expect(kind(c.propose(transfer("a.near", 5n * NEAR), tprov(own, own), fh()))).toBe("Executed");
    expect(c.propose(transfer("a.near", 1n), tprov(own, own), fh())).toEqual({ Rejected: { reason: "global cap exceeded" } });
  });

  it("does not let many small transfers slip past the cap", () => {
    let executed = 0;
    for (let i = 0; i < 20; i++) {
      if (kind(c.propose(transfer("a.near", NEAR / 2n), tprov(own, own), fh())) === "Executed") executed++;
    }
    expect(executed).toBe(10);
    expect(c.spent24h()).toBe(5n * NEAR);
  });
});

describe("proposals and co-sign", () => {
  it("propose_duplicate_flow_hash_rejected", () => {
    const f = fh();
    c.propose(transfer("a.near", NEAR / 10n), tprov(own, own), f);
    expect(c.propose(transfer("a.near", NEAR / 10n), tprov(own, own), f)).toEqual({ Rejected: { reason: "duplicate flow_hash" } });
  });

  const pending = () => {
    const o = c.propose(transfer("new.near", NEAR / 2n), tprov(unt("x.com/@a"), own), fh());
    if (!("Pending" in o)) throw new Error("expected pending");
    return o.Pending;
  };

  it("pending_stores_hash_and_is_listed", () => {
    const p = pending();
    expect(c.getPending().map((x) => x.proposalId)).toEqual([p.proposal_id]);
    expect(c.getPending()[0].proposalHash).toBe(p.proposal_hash);
  });

  it("cosign_executes_and_counts_toward_the_cap", () => {
    const p = pending();
    expect(kind(c.cosign(p.proposal_id, p.proposal_hash, false))).toBe("Executed");
    expect(c.spent24h()).toBe(NEAR / 2n);
    expect(c.getPending()).toHaveLength(0);
  });

  it("cosign_wrong_hash_fails", () => {
    const p = pending();
    expect(() => c.cosign(p.proposal_id, "wrong", false)).toThrow("hash mismatch");
  });

  it("cosign_twice_fails", () => {
    const p = pending();
    c.cosign(p.proposal_id, p.proposal_hash, false);
    expect(() => c.cosign(p.proposal_id, p.proposal_hash, false)).toThrow("not pending");
  });

  it("cosign_unknown_id_fails", () => {
    expect(() => c.cosign(99, "h", false)).toThrow("not pending");
  });

  it("cosign_expired_fails", () => {
    const p = pending();
    t += 16 * MIN;
    expect(() => c.cosign(p.proposal_id, p.proposal_hash, false)).toThrow("expired");
  });

  it("cosign_remember_adds_book_entry_with_defaults", () => {
    const p = pending();
    c.cosign(p.proposal_id, p.proposal_hash, true);
    const e = c.getBook().find((b) => b.address === "new.near")!;
    expect(e.cap).toBe(1n * NEAR);
  });

  it("cosign_without_remember_adds_nothing", () => {
    const p = pending();
    c.cosign(p.proposal_id, p.proposal_hash, false);
    expect(c.getBook()).toHaveLength(0);
  });

  it("cosign_over_the_rolling_cap_is_rejected", () => {
    const p = pending();
    c.propose(transfer("a.near", 5n * NEAR), tprov(own, own), fh());
    expect(c.cosign(p.proposal_id, p.proposal_hash, false)).toEqual({ Rejected: { reason: "global cap exceeded" } });
  });
});
