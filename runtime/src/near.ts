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

const RPC = { testnet: "https://test.rpc.fastnear.com", mainnet: "https://free.rpc.fastnear.com" } as const;
const GAS = 100_000_000_000_000n; // 100 Tgas

const mapPending = (rows: [number, any][]): PendingProposal[] =>
  rows.map(([id, p]) => ({
    proposalId: id,
    proposalHash: p.hash,
    action: p.action,
    prov: p.prov,
    flowHash: p.flow_hash,
    createdAt: Number(BigInt(p.created_at) / 1_000_000n),
  }));

const mapBook = (rows: [string, any][]): BookEntry[] =>
  rows.map(([address, e]) => ({ address, cap: BigInt(e.cap), expiresAt: Number(BigInt(e.expires_at) / 1_000_000n), learnedFrom: e.learned_from }));

/** Reads the deployed contract with no key at all. */
export class NearViewClient {
  private provider: JsonRpcProvider;

  constructor(private o: { network: "testnet" | "mainnet"; contractId: string; rpcUrl?: string }) {
    this.provider = new JsonRpcProvider({ url: o.rpcUrl ?? RPC[o.network] });
  }

  private async view(methodName: string, owner: string): Promise<any> {
    return this.provider.callFunction(this.o.contractId, methodName, { owner });
  }

  async getPending(owner: string): Promise<PendingProposal[]> {
    return mapPending(((await this.view("get_pending", owner)) as [number, any][] | undefined) ?? []);
  }

  async getBook(owner: string): Promise<BookEntry[]> {
    return mapBook(((await this.view("get_book", owner)) as [string, any][] | undefined) ?? []);
  }

  async getPins(owner: string): Promise<string[]> {
    return ((await this.view("get_pins", owner)) as string[] | undefined) ?? [];
  }

  async getSpent24h(owner: string): Promise<string> {
    return ((await this.view("get_spent_24h", owner)) as string | undefined) ?? "0";
  }

  /** null when the owner has not opened an account. */
  async getAccount(owner: string): Promise<AccountInfo | null> {
    return ((await this.view("get_account", owner)) as AccountInfo | null | undefined) ?? null;
  }
}

export interface AccountInfo {
  balance: string;
  paused: boolean;
  workers: string[];
  config: { remember_cap: string; remember_ttl_ns: string; payee_cooldown_ns: string; payee_cooldown_cap: string; global_cap_24h: string };
}

export interface NearClientOptions {
  network: "testnet" | "mainnet";
  contractId: string;
  /** Whose account in the contract this client proposes for. */
  owner: string;
  workerAccount: string;
  workerSecretKey: string;
  rpcUrl?: string;
}

/** LIVE: calls the deployed taint.near as a worker the owner authorised, proposing for that owner's account. */
export class NearContractClient implements ContractClient {
  private account: Account;
  private contractId: string;
  private owner: string;

  constructor(o: NearClientOptions) {
    this.owner = o.owner;
    const provider = new JsonRpcProvider({ url: o.rpcUrl ?? RPC[o.network] });
    const signer = KeyPairSigner.fromSecretKey(o.workerSecretKey as `ed25519:${string}`);
    this.account = new Account(o.workerAccount, provider, signer);
    this.contractId = o.contractId;
  }

  async propose(action: ProposedAction, prov: ArgProvenance, flowHash: string) {
    const res = await this.account.callFunctionRaw({
      contractId: this.contractId,
      methodName: "propose",
      args: { owner: this.owner, action, prov, flow_hash: flowHash },
      gas: GAS,
      deposit: 0n,
    });
    const status = res.status as { SuccessValue?: string; Failure?: unknown };
    if (status.SuccessValue === undefined) throw new Error("propose failed: " + JSON.stringify(status.Failure ?? status));
    const outcome = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8")) as ProposalOutcome;
    return { outcome, txHash: res.transaction.hash as string };
  }

  async getPending(): Promise<PendingProposal[]> {
    return mapPending((await this.account.viewFunction({ contractId: this.contractId, methodName: "get_pending", args: { owner: this.owner } })) as [number, any][]);
  }

  async getBook(): Promise<BookEntry[]> {
    return mapBook((await this.account.viewFunction({ contractId: this.contractId, methodName: "get_book", args: { owner: this.owner } })) as [string, any][]);
  }

  async getPins(): Promise<string[]> {
    return (await this.account.viewFunction({ contractId: this.contractId, methodName: "get_pins", args: { owner: this.owner } })) as string[];
  }

  async getSpent24h(): Promise<string> {
    return (await this.account.viewFunction({ contractId: this.contractId, methodName: "get_spent_24h", args: { owner: this.owner } })) as string;
  }
}
