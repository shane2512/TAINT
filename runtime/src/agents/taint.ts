import { extract } from "../extractor";
import { HandleStore } from "../handles";
import { mode } from "../llm";
import type { ContractClient } from "../near";
import { SignedOwnerMessage, verifyOwnerMessage } from "../owner";
import { plan } from "../planner";
import { buildProposal } from "../proposal";
import type { Agent, AgentResult } from "./types";

export interface TaintAgentOptions {
  client: ContractClient;
  ownerPublicKey: string;
  network: string;
}

export class TaintAgent implements Agent {
  readonly name = "taint" as const;

  constructor(private o: TaintAgentOptions) {}

  async run(msg: SignedOwnerMessage): Promise<AgentResult> {
    const base = { agent: this.name, network: this.o.network, mode: mode() };
    if (!verifyOwnerMessage(msg, this.o.ownerPublicKey)) {
      return { ...base, outcome: "none", reasons: ["owner signature invalid"] };
    }

    const store = new HandleStore();
    for (const a of msg.attachments) await extract(a, store);
    const planned = await plan(msg.instruction, store.summaries());
    const proposal = buildProposal(planned, store, msg.nonce);
    if (!proposal) return { ...base, outcome: "none", reasons: ["no executable action"] };

    const { outcome, txHash } = await this.o.client.propose(proposal.action, proposal.prov, proposal.flowHash);
    const common = { ...base, txHash, action: proposal.action, provenance: proposal.prov };
    if ("Executed" in outcome) return { ...common, outcome: "executed" };
    if ("Pending" in outcome) return { ...common, outcome: "pending", reasons: outcome.Pending.reasons };
    return { ...common, outcome: "blocked", reasons: [outcome.Rejected.reason] };
  }
}
