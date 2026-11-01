import type { SignedOwnerMessage } from "../owner";
import type { ArgProvenance, ProposedAction } from "../proposal";

export interface AgentResult {
  agent: "naive" | "allowlist" | "taint";
  outcome: "executed" | "pending" | "blocked" | "none";
  txHash?: string;
  reasons?: string[];
  provenance?: ArgProvenance;
  action?: ProposedAction;
  network: string;
  mode: "LIVE" | "MOCK";
}

export interface Agent {
  name: AgentResult["agent"];
  run(msg: SignedOwnerMessage): Promise<AgentResult>;
}
