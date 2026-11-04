"use client";
// The visitor's own wallet. Reads the real contract through the runtime; every write is a transaction or a signed message
// that the visitor's wallet makes. No key is held by this site.
import "@near-wallet-selector/modal-ui/styles.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { outcomeOf, type Outcome } from "../lib/outcome";
import { api, useApi } from "./ui";

export interface LiveInfo {
  network: "testnet" | "mainnet";
  contractId: string;
  workerAccount: string;
  suggestedDepositNear: string;
  limits: { perOwnerPerHour: number; perIpPerHour: number; perDay: number };
  presets: { id: string; title: string; kind: "attack" | "legit"; instruction: string; attachments: { source: string; text: string }[] }[];
}

export interface Signed {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  nonce: string;
  recipient: string;
}

export interface Held {
  proposalId: number;
  proposalHash: string;
  action: { kind: "Transfer" | "Swap"; recipient: string | null; token: string | null };
  sourceLine: string;
  diff: string | null;
  amountNear: string;
}

export interface AccountState {
  exists: boolean;
  balanceNear: string | null;
  paused: boolean;
  workerAuthorised: boolean;
  workers: string[];
  globalCapNear: string | null;
  spent24hNear: string;
  held: Held[];
  book: { address: string; capNear: string; expiresAt: number; learnedFrom: string }[];
  pins: string[];
}

/** What the pages need from a wallet. A browser test can stand in for it, but only in a build made for tests. */
export interface WalletLike {
  accountId: () => string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  signMessage: (message: string, recipient: string) => Promise<Signed>;
  call: (method: string, args: object, depositYocto: bigint) => Promise<unknown>;
  onChange: (fn: () => void) => () => void;
}

const GAS = 100_000_000_000_000n; // 100 Tgas
export const YOCTO = 10n ** 24n;
export function nearToYocto(near: string): bigint | null {
  if (!/^\d+(\.\d{1,24})?$/.test(near.trim())) return null;
  const [w, f = ""] = near.trim().split(".");
  return BigInt(w) * YOCTO + BigInt(f.padEnd(24, "0"));
}
export const explorer = (network: string, hash: string) => `https://${network === "mainnet" ? "" : network + "."}nearblocks.io/txns/${hash}`;
const rpcFor = (network: string) => process.env.NEXT_PUBLIC_NEAR_RPC ?? (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function realWallet(info: LiveInfo): Promise<WalletLike> {
  const { actionCreators } = await import("@near-js/transactions");
  const { setupWalletSelector } = await import("@near-wallet-selector/core");
  const { setupModal } = await import("@near-wallet-selector/modal-ui");
  const { setupMeteorWallet } = await import("@near-wallet-selector/meteor-wallet");
  // The wallet library defaults to the public RPC that now rate limits and says it is deprecated: name a working one.
  const network = info.network === "mainnet"
    ? { networkId: "mainnet", nodeUrl: rpcFor("mainnet"), helperUrl: "https://helper.mainnet.near.org", explorerUrl: "https://nearblocks.io", indexerUrl: "https://api.kitwallet.app" }
    : { networkId: "testnet", nodeUrl: rpcFor("testnet"), helperUrl: "https://helper.testnet.near.org", explorerUrl: "https://testnet.nearblocks.io", indexerUrl: "https://testnet-api.kitwallet.app" };
  const selector = await setupWalletSelector({ network, modules: [setupMeteorWallet()] });
  const modal = setupModal(selector, { contractId: info.contractId });
  const account = () => selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
  return {
    accountId: account,
    connect: () => modal.show(),
    disconnect: async () => (await selector.wallet()).signOut(),
    signMessage: async (message, recipient) => {
      const wallet = await selector.wallet();
      if (!wallet.signMessage) throw new Error("this wallet cannot sign messages");
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))); // the wallet library insists on a Buffer
      const out = await wallet.signMessage({ message, recipient, nonce });
      if (!out) throw new Error("the wallet returned no signature");
      return { accountId: out.accountId, publicKey: out.publicKey.includes(":") ? out.publicKey : `ed25519:${out.publicKey}`, signature: out.signature, message, nonce: b64(new Uint8Array(nonce)), recipient };
    },
    call: async (method, args, deposit) =>
      (await selector.wallet()).signAndSendTransaction({ receiverId: info.contractId, actions: [actionCreators.functionCall(method, args, GAS, deposit)] }),
    onChange: (fn) => {
      const sub = selector.store.observable.subscribe(fn);
      return () => sub.unsubscribe();
    },
  };
}

interface Ctx {
  info: LiveInfo | null;
  offline: string | null;
  account: string | null;
  ready: boolean;
  state: AccountState | null;
  stateError: string | null;
  reload: () => Promise<void>;
  connect: () => void;
  disconnect: () => Promise<void>;
  sign: (message: string) => Promise<Signed>;
  /** Send one contract call from the visitor's wallet and say what it really did. */
  send: (method: string, args: object, depositNear?: string) => Promise<Outcome>;
  /** The outcome of a transaction the wallet redirected away to sign, found on return. */
  returned: Outcome | null;
}
const WalletCtx = createContext<Ctx | null>(null);
export const useLive = () => useContext(WalletCtx);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { data: info, error: infoError } = useApi<LiveInfo>("live/info");
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AccountState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [returned, setReturned] = useState<Outcome | null>(null);
  const wallet = useRef<WalletLike | null>(null);

  const reload = useCallback(async () => {
    if (!account) { setState(null); return; }
    try {
      const r = await api<AccountState>(`live/account?owner=${encodeURIComponent(account)}`);
      if (r.ok) { setState(r.body as AccountState); setStateError(null); } else setStateError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setStateError("The runtime did not answer.");
    }
  }, [account]);

  useEffect(() => {
    if (!info) return;
    let off: (() => void) | undefined;
    let gone = false;
    (async () => {
      try {
        const mock = process.env.NEXT_PUBLIC_WALLET_MOCK === "1" ? (window as unknown as { __tainttest?: WalletLike }).__tainttest : undefined;
        const w = mock ?? (await realWallet(info));
        if (gone) return;
        wallet.current = w;
        setAccount(w.accountId());
        setReady(true);
        off = w.onChange(() => setAccount(w.accountId()));
        // A wallet that sends you away to sign brings you back with the transaction's hash in the address.
        const hash = new URLSearchParams(location.search).get("transactionHashes");
        if (hash && w.accountId()) {
          const res = await fetch(rpcFor(info.network), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: [hash.split(",").pop(), w.accountId()] }) });
          const out = outcomeOf((await res.json()).result);
          setReturned({ ...out, txHash: out.txHash ?? hash });
          history.replaceState(null, "", location.pathname);
        }
      } catch {
        if (!gone) setReady(false);
      }
    })();
    return () => { gone = true; off?.(); };
  }, [info]);

  useEffect(() => { void reload(); }, [reload, returned]);

  const value = useMemo<Ctx>(() => ({
    info: info ?? null,
    offline: infoError,
    account,
    ready,
    state,
    stateError,
    reload,
    returned,
    connect: () => wallet.current?.connect(),
    disconnect: async () => { await wallet.current?.disconnect(); setAccount(null); },
    sign: async (message) => {
      if (!wallet.current || !info) throw new Error("the wallet is not ready");
      return wallet.current.signMessage(message, info.contractId);
    },
    send: async (method, args, depositNear = "0") => {
      if (!wallet.current) return { ok: false, why: "the wallet is not ready" };
      const deposit = nearToYocto(depositNear);
      if (deposit === null) return { ok: false, why: "that is not a NEAR amount" };
      try {
        const out = outcomeOf((await wallet.current.call(method, args, deposit)) as Parameters<typeof outcomeOf>[0]);
        void reload();
        return out;
      } catch (e) {
        return { ok: false, why: `the wallet did not sign: ${(e as Error).message}` };
      }
    },
  }), [info, infoError, account, ready, state, stateError, reload, returned]);

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

/** The account bar every live page starts with: connect, open an account, authorise the agent. */
export function AccountGate({ children }: { children: React.ReactNode }) {
  const live = useLive();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Outcome | null>(null);
  if (!live || !live.info) return <p className="hint" role="status">Looking for the contract...</p>;
  const { info, account, state } = live;
  const deposit = amount || info.suggestedDepositNear;

  async function step(method: string, args: object, near = "0") {
    setBusy(true);
    setNote(await live!.send(method, args, near));
    setBusy(false);
  }

  if (!account) {
    return (
      <section className="gate" data-testid="gate-connect" aria-label="Connect your wallet">
        <h2 className="h-sm">Connect your own testnet wallet.</h2>
        <p className="hint">Your payments here are real {info.network} transactions from an account in <code>{info.contractId}</code> that only you control. You need a {info.network} account with some test NEAR: <a href="https://near-faucet.io/" target="_blank" rel="noreferrer">get free test NEAR</a>, then <a href="https://meteorwallet.app/" target="_blank" rel="noreferrer">install the Meteor Wallet extension</a> (without it, Meteor opens its own wallet window).</p>
        <button className="btn primary" onClick={live.connect} disabled={!live.ready} data-testid="wallet-connect">Connect wallet</button>
      </section>
    );
  }
  if (live.stateError) return <p className="error" role="alert">{live.stateError}</p>;
  if (!state) return <p className="hint" role="status">Reading your account from {info.network}...</p>;
  if (!state.exists) {
    return (
      <section className="gate" data-testid="gate-open" aria-label="Open your account">
        <h2 className="h-sm">Open your account.</h2>
        <p className="hint">Connected as <b>{account}</b>. Your account in the contract holds your own balance, address book, pins and daily cap. You deposit test NEAR now and can withdraw it any time. The deposit also pays for the storage your account uses. The attack presets try to move up to 1.5 NEAR, so deposit at least 2 to see them held and approved.</p>
        <div className="inline">
          <label><span className="gl">DEPOSIT (NEAR)</span><input className="txt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={info.suggestedDepositNear} inputMode="decimal" data-testid="deposit-amount" /></label>
          <button className="btn primary" disabled={busy} onClick={() => step("create_account", { workers: [info.workerAccount] }, deposit)} data-testid="open-account">Open account with {deposit} NEAR</button>
        </div>
        {note && !note.ok && <p className="error" role="alert">{note.why}</p>}
        {note?.ok && <p className="okay" role="status">Opened. Reading your account...</p>}
      </section>
    );
  }
  if (!state.workerAuthorised) {
    return (
      <section className="gate" data-testid="gate-worker" aria-label="Authorise the agent">
        <h2 className="h-sm">Authorise the agent.</h2>
        <p className="hint">Only agents you name can propose payments from your account. Authorise <code>{info.workerAccount}</code>; you can revoke it any time on the Wallet page.</p>
        <button className="btn primary" disabled={busy} onClick={() => step("register_worker", { worker: info.workerAccount })} data-testid="authorise">Authorise {info.workerAccount}</button>
        {note && !note.ok && <p className="error" role="alert">{note.why}</p>}
      </section>
    );
  }
  return <>{children}</>;
}
