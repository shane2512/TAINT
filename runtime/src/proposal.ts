import { createHash } from "node:crypto";
import bs58 from "bs58";
import { HandleKind, HandleStore, parseAccount, parseAmountYocto } from "./handles";
import type { ArgRef, PlannedAction } from "./planner";

export type TrustClass = "Owner" | "Untrusted";
export interface Provenance {
  class: TrustClass;
  source: string;
}
export type ActionKind = "Transfer" | "Swap";
export interface ProposedAction {
  kind: ActionKind;
  recipient: string | null;
  token: string | null;
  amount: string; // yocto
}
export interface ArgProvenance {
  recipient: Provenance | null;
  token: Provenance | null;
  amount: Provenance;
}
export type ProposalOutcome =
  | { Executed: { proposal_id: number } }
  | { Pending: { proposal_id: number; proposal_hash: string; reasons: string[] } }
  | { Rejected: { reason: string } };

export interface Proposal {
  action: ProposedAction;
  prov: ArgProvenance;
  flowHash: string;
}

type ArgType = "recipient" | "token" | "amount";
const HANDLE_KIND: Record<ArgType, HandleKind> = { recipient: "Account", token: "Token", amount: "Amount" };

class BadArg extends Error {}

const MAX_SOURCE = 128;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** An Owner-class value must appear, as a whole token, in what the owner actually signed. */
function grounded(text: string, type: ArgType, instruction: string): boolean {
  const hay = squash(instruction);
  const needle = escapeRe(squash(text));
  const re = type === "amount" ? new RegExp(`(?<![\\w.])${needle}(?!\\w)`) : new RegExp(`(?<![\\w.-])${needle}(?!\\.?[\\w-])`);
  return re.test(hay);
}

const ACCOUNT_CANDIDATE = /(?<![\w.-])(?:[a-z\d_-]+\.)+[a-z_-][a-z\d_-]*(?![\w-])/g;
const AMOUNT_CANDIDATE = /(?<![\w.])\d+(?:\.\d+)?\s*near(?!\w)/g;

/**
 * How many distinct values of this role the owner's instruction offers. Grounding shows the owner typed a value,
 * not which role they meant it for; with more than one candidate a wrong (or fooled) planner could pick the wrong one.
 */
function candidates(type: ArgType, instruction: string): number {
  const hay = squash(instruction);
  const found = hay.match(type === "amount" ? AMOUNT_CANDIDATE : ACCOUNT_CANDIDATE) ?? [];
  return new Set(found.map((f) => (type === "amount" ? (parseAmountYocto(f) ?? f) : f))).size;
}

function resolve(
  r: ArgRef,
  type: ArgType,
  store: HandleStore,
  instruction?: string,
): { value: string; prov: Provenance; handleId: string | null } {
  if ("literal" in r) {
    const value = type === "amount" ? parseAmountYocto(r.literal) : parseAccount(r.literal);
    if (value === null) throw new BadArg(`bad literal for ${type}`);
    // The planner only ever sees owner text, but it is still an LLM: do not let it mint Owner-class values.
    if (instruction !== undefined && !grounded(type === "amount" ? r.literal : value, type, instruction)) {
      throw new BadArg(`literal for ${type} does not appear in the owner instruction`);
    }
    const ambiguous = instruction !== undefined && candidates(type, instruction) > 1;
    const prov: Provenance = ambiguous ? { class: "Untrusted", source: "owner-ambiguous" } : { class: "Owner", source: "owner" };
    return { value, prov, handleId: null };
  }
  let h;
  try {
    h = store.get(r.handle);
  } catch {
    throw new BadArg(`unknown handle ${r.handle}`);
  }
  if (h.kind !== HANDLE_KIND[type]) throw new BadArg(`handle ${h.id} is a ${h.kind}, not usable as ${type}`);
  // taint.near refuses sources over 128 bytes, and the source text is attacker-chosen (a URL, a username)
  return { value: h.value, prov: { class: "Untrusted", source: h.source.slice(0, MAX_SOURCE) }, handleId: h.id };
}

export function buildProposal(
  p: PlannedAction,
  store: HandleStore,
  ownerNonce: string,
  ownerInstruction?: string,
): Proposal | null {
  if (p.kind === "None" || !p.amount) return null;
  if (p.kind === "Transfer" && (!p.recipient || p.token)) return null;
  if (p.kind === "Swap" && (!p.token || p.recipient)) return null;
  try {
    const recipient = p.recipient ? resolve(p.recipient, "recipient", store, ownerInstruction) : null;
    const token = p.token ? resolve(p.token, "token", store, ownerInstruction) : null;
    const amount = resolve(p.amount, "amount", store, ownerInstruction);
    const action: ProposedAction = {
      kind: p.kind,
      recipient: recipient?.value ?? null,
      token: token?.value ?? null,
      amount: amount.value,
    };
    const prov: ArgProvenance = {
      recipient: recipient?.prov ?? null,
      token: token?.prov ?? null,
      amount: amount.prov,
    };
    // One signed owner message maps to one flow, whatever a (possibly nondeterministic) model plans. If this hashed
    // the plan, re-submitting the same message could yield a different plan, a new hash, and a second execution.
    const flowHash = bs58.encode(createHash("sha256").update("taint:flow:" + ownerNonce).digest());
    return { action, prov, flowHash };
  } catch (e) {
    if (e instanceof BadArg) return null;
    throw e;
  }
}
