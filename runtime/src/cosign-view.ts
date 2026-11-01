import type { PendingProposal } from "./mock-contract";
import type { ProposedAction } from "./proposal";
import { provenanceLine } from "./provenance";

const YOCTO = 10n ** 24n;

export function formatNear(yocto: string): string {
  const y = BigInt(yocto);
  const whole = y / YOCTO;
  const frac = (y % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The known counterparty this address most resembles, if it resembles one closely enough to matter. */
export function nearestEntry(address: string, known: string[]): { entry: string; distance: number } | null {
  const limit = Math.min(3, Math.floor(address.length / 4));
  let best: { entry: string; distance: number } | null = null;
  for (const entry of known) {
    const distance = levenshtein(address, entry);
    if (distance <= limit && (best === null || distance < best.distance)) best = { entry, distance };
  }
  return best;
}

export interface PendingView {
  proposalId: number;
  proposalHash: string;
  action: ProposedAction;
  sourceLine: string;
  nearestBookEntry: string | null;
  diff: string | null;
  amountNear: string;
  amountUsd: null; // no price feed is configured
  accountCreated: string; // no indexer is configured
}

/** What the owner sees before co-signing: where each value came from, and whether the address is a lookalike. */
export function describePending(p: PendingProposal, known: string[]): PendingView {
  const near = p.action.recipient ? nearestEntry(p.action.recipient, known) : null;
  let diff: string | null = null;
  if (near) {
    diff =
      near.distance === 0
        ? `same as known counterparty ${near.entry}`
        : `${p.action.recipient} vs ${near.entry}: ${near.distance} character${near.distance === 1 ? "" : "s"} differ`;
  }
  return {
    proposalId: p.proposalId,
    proposalHash: p.proposalHash,
    action: p.action,
    sourceLine: provenanceLine(p.prov),
    nearestBookEntry: near?.entry ?? null,
    diff,
    amountNear: formatNear(p.action.amount),
    amountUsd: null,
    accountCreated: "unknown",
  };
}
