import fs from "node:fs";
import type { ProposedAction } from "../proposal";
import { NaiveAgent, NaiveOptions } from "./naive";

// The Allowlist+Caps baseline: a rule filter in front of the naive agent. It does no
// transaction simulation. Its config is frozen at git tag `baseline-frozen`.
export interface AllowlistConfig {
  recipients: string[];
  tokens: string[];
  per_tx_cap_yocto: string;
}

export function loadConfig(file = "baselines/allowlist.json"): AllowlistConfig {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Returns the reason to block, or null to allow. */
export function filter(a: ProposedAction, c: AllowlistConfig): string | null {
  if (a.recipient && !c.recipients.includes(a.recipient)) return "recipient not allowlisted";
  if (a.token && !c.tokens.includes(a.token)) return "token not allowlisted";
  if (BigInt(a.amount) > BigInt(c.per_tx_cap_yocto)) return "over per-tx cap";
  return null;
}

export class AllowlistCapsAgent extends NaiveAgent {
  constructor(
    o: NaiveOptions,
    private cfg: AllowlistConfig,
  ) {
    super(o, "allowlist");
  }

  protected override gate(action: ProposedAction): string | null {
    return filter(action, this.cfg);
  }
}
