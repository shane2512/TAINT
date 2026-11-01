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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** An Owner-class value must appear, as a whole token, in what the owner actually signed. */
function grounded(text: string, type: ArgType, instruction: string): boolean {
  const hay = squash(instruction);
  const needle = escapeRe(squash(text));
  const re = type === "amount" ? new RegExp(`(?<![\\w.])${needle}(?!\\w)`) : new RegExp(`(?<![\\w.-])${needle}(?!\\.?[\\w-])`);
  return re.test(hay);
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
