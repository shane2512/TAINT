import type { MockContract } from "../runtime/src/mock-contract";

export interface Setup {
  pins?: string[];
  payees?: { by: string; address: string }[];
  /** Owner-approved address-book entries (default cap and expiry). */
  remember?: string[];
}

export function applySetup(c: MockContract, s: Setup = {}): void {
  for (const p of s.pins ?? []) c.pin(p);
  for (const p of s.payees ?? []) c.registerPayee(p.by, p.address);
  for (const a of s.remember ?? []) c.remember(a);
}
