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

function resolve(r: ArgRef, type: ArgType, store: HandleStore): { value: string; prov: Provenance; handleId: string | null } {
  if ("literal" in r) {
    const value = type === "amount" ? parseAmountYocto(r.literal) : parseAccount(r.literal);
    if (value === null) throw new BadArg(`bad literal for ${type}`);
    return { value, prov: { class: "Owner", source: "owner" }, handleId: null };
  }
  let h;
  try {
    h = store.get(r.handle);
  } catch {
    throw new BadArg(`unknown handle ${r.handle}`);
  }
  if (h.kind !== HANDLE_KIND[type]) throw new BadArg(`handle ${h.id} is a ${h.kind}, not usable as ${type}`);
  return { value: h.value, prov: { class: "Untrusted", source: h.source }, handleId: h.id };
}

export function buildProposal(p: PlannedAction, store: HandleStore, ownerNonce: string): Proposal | null {
  if (p.kind === "None" || !p.amount) return null;
  if (p.kind === "Transfer" && (!p.recipient || p.token)) return null;
  if (p.kind === "Swap" && (!p.token || p.recipient)) return null;
  try {
    const recipient = p.recipient ? resolve(p.recipient, "recipient", store) : null;
    const token = p.token ? resolve(p.token, "token", store) : null;
    const amount = resolve(p.amount, "amount", store);
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
    const handleIds = { recipient: recipient?.handleId ?? null, token: token?.handleId ?? null, amount: amount.handleId };
    const flowHash = bs58.encode(
      createHash("sha256").update(JSON.stringify({ action, prov, handleIds, ownerNonce })).digest(),
    );
    return { action, prov, flowHash };
  } catch (e) {
    if (e instanceof BadArg) return null;
    throw e;
  }
}
