import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import type { MockContract, BookEntry, PendingProposal } from "./mock-contract";
import type { ArgProvenance, ProposalOutcome, ProposedAction } from "./proposal";

export interface ContractClient {
  propose(action: ProposedAction, prov: ArgProvenance, flowHash: string): Promise<{ outcome: ProposalOutcome; txHash: string }>;
  getPending(): Promise<PendingProposal[]>;
  getBook(): Promise<BookEntry[]>;
}

/** MOCK=1: evaluates against the local MockContract. */
export class MockContractClient implements ContractClient {
  constructor(private contract: MockContract) {}

  async propose(action: ProposedAction, prov: ArgProvenance, flowHash: string) {
    return { outcome: this.contract.propose(action, prov, flowHash), txHash: "mock" };
  }
  async getPending() {
    return this.contract.getPending();
  }
  async getBook() {
    return this.contract.getBook();
  }
}

const RPC = { testnet: "https://rpc.testnet.near.org", mainnet: "https://rpc.mainnet.near.org" } as const;
const GAS = 100_000_000_000_000n; // 100 Tgas

export interface NearClientOptions {
  network: "testnet" | "mainnet";
  contractId: string;
  workerAccount: string;
  workerSecretKey: string;
  rpcUrl?: string;
}

/**
 * LIVE: calls the deployed taint.near as the registered worker.
 * UNTESTED until taint.near is deployed (plan Task 5); its view-JSON mapping follows the Rust types in plan Task 3.
 */
export class NearContractClient implements ContractClient {
  private account: Account;
  private contractId: string;

  constructor(o: NearClientOptions) {
    const provider = new JsonRpcProvider({ url: o.rpcUrl ?? RPC[o.network] });
    const signer = KeyPairSigner.fromSecretKey(o.workerSecretKey as `ed25519:${string}`);
    this.account = new Account(o.workerAccount, provider, signer);
    this.contractId = o.contractId;
  }

  async propose(action: ProposedAction, prov: ArgProvenance, flowHash: string) {
    const res = await this.account.callFunctionRaw({
      contractId: this.contractId,
      methodName: "propose",
      args: { action, prov, flow_hash: flowHash },
      gas: GAS,
      deposit: 0n,
    });
    const status = res.status as { SuccessValue?: string; Failure?: unknown };
    if (status.SuccessValue === undefined) throw new Error("propose failed: " + JSON.stringify(status.Failure ?? status));
    const outcome = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8")) as ProposalOutcome;
    return { outcome, txHash: res.transaction.hash as string };
  }

  async getPending(): Promise<PendingProposal[]> {
    const rows = (await this.account.viewFunction({ contractId: this.contractId, methodName: "get_pending", args: {} })) as [number, any][];
    return rows.map(([id, p]) => ({
      proposalId: id,
      proposalHash: p.hash,
      action: p.action,
      prov: p.prov,
      flowHash: p.flow_hash,
      createdAt: Number(BigInt(p.created_at) / 1_000_000n),
    }));
  }

  async getBook(): Promise<BookEntry[]> {
    const rows = (await this.account.viewFunction({ contractId: this.contractId, methodName: "get_book", args: {} })) as [string, any][];
    return rows.map(([address, e]) => ({
      address,
      cap: BigInt(e.cap),
      expiresAt: Number(BigInt(e.expires_at) / 1_000_000n),
      learnedFrom: e.learned_from,
    }));
  }
}
