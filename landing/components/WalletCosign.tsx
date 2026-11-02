"use client";
import "@near-wallet-selector/modal-ui/styles.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeOf, type Outcome } from "../lib/outcome";
import { api, ErrorNote, Icon } from "./ui";

interface Info { network: string; contractId: string; ownerAccount: string }
interface Pending { proposalId: number; proposalHash: string; action: { kind: "Transfer" | "Swap"; recipient: string | null; token: string | null }; sourceLine: string; diff: string | null; amountNear: string }

/** What the page needs from a wallet. A test can stand in for it with window.__tainttest when built with NEXT_PUBLIC_WALLET_MOCK=1. */
interface WalletLike {
  accountId: () => string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  cosign: (info: Info, p: Pending, remember: boolean) => Promise<unknown>;
  onChange: (fn: () => void) => () => void;
}

const GAS = 100_000_000_000_000n; // 100 Tgas
const rpcFor = (network: string) => process.env.NEXT_PUBLIC_NEAR_RPC ?? (network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
const explorer = (network: string, hash: string) => `https://${network === "mainnet" ? "" : network + "."}nearblocks.io/txns/${hash}`;

async function realWallet(info: Info): Promise<WalletLike> {
  const { actionCreators } = await import("@near-js/transactions");
  const { setupWalletSelector } = await import("@near-wallet-selector/core");
  const { setupModal } = await import("@near-wallet-selector/modal-ui");
  const { setupMyNearWallet } = await import("@near-wallet-selector/my-near-wallet");
  const selector = await setupWalletSelector({ network: info.network as "testnet" | "mainnet", modules: [setupMyNearWallet()] });
  const modal = setupModal(selector, { contractId: info.contractId });
  const account = () => selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
  return {
    accountId: account,
    connect: () => modal.show(),
    disconnect: async () => (await selector.wallet()).signOut(),
    cosign: async (i, p, remember) =>
      (await selector.wallet()).signAndSendTransaction({
        receiverId: i.contractId,
        actions: [actionCreators.functionCall("cosign", { proposal_id: p.proposalId, proposal_hash: p.proposalHash, remember }, GAS, 0n)],
      }),
    onChange: (fn) => {
      const sub = selector.store.observable.subscribe(fn);
      return () => sub.unsubscribe();
    },
  };
}

export default function WalletCosign() {
  const [info, setInfo] = useState<Info | null | "off">(null);
  const [held, setHeld] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, Outcome | "sending">>({});
  const [back, setBack] = useState<Outcome | null>(null);
  const wallet = useRef<WalletLike | null>(null);

  const loadHeld = useCallback(async () => {
    try {
      const r = await api<Pending[]>("chain/pending");
      if (r.ok) { setHeld(r.body as unknown as Pending[]); setError(null); } else setError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setError("The runtime did not answer.");
    }
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    (async () => {
      try {
        const r = await api<Info>("chain/info");
        if (gone) return;
        if (!r.ok) { setInfo("off"); return; }
        const i = r.body as Info;
        setInfo(i);
        void loadHeld();
        const mock = process.env.NEXT_PUBLIC_WALLET_MOCK === "1" ? (window as unknown as { __tainttest?: WalletLike }).__tainttest : undefined;
        const w = mock ?? (await realWallet(i));
        if (gone) return;
        wallet.current = w;
        setAccount(w.accountId());
        off = w.onChange(() => setAccount(w.accountId()));

        // A wallet that sends you away to sign brings you back with the transaction's hash in the address.
        const hash = new URLSearchParams(location.search).get("transactionHashes");
        if (hash && w.accountId()) {
          const res = await fetch(rpcFor(i.network), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: [hash.split(",").pop(), w.accountId()] }) });
          const out = outcomeOf((await res.json()).result);
          setBack({ ...out, txHash: out.txHash ?? hash });
          history.replaceState(null, "", location.pathname);
          void loadHeld();
        }
      } catch {
        if (!gone) setInfo("off");
      }
    })();
    return () => { gone = true; off?.(); };
  }, [loadHeld]);

  async function approve(p: Pending, remember: boolean) {
    if (!wallet.current || info === null || info === "off") return;
    setResults((r) => ({ ...r, [p.proposalId]: "sending" }));
    try {
      const out = outcomeOf((await wallet.current.cosign(info, p, remember)) as Parameters<typeof outcomeOf>[0]);
      setResults((r) => ({ ...r, [p.proposalId]: out }));
      if (out.ok) void loadHeld();
    } catch (e) {
      setResults((r) => ({ ...r, [p.proposalId]: { ok: false, why: `the wallet did not sign: ${(e as Error).message}` } }));
    }
  }

  if (info === null) return <p className="hint" role="status">Looking for the testnet contract...</p>;
  if (info === "off") return <p className="empty" data-testid="wallet-off">This server has no testnet contract configured, or your wallet could not start.</p>;

  const isOwner = account !== null && account === info.ownerAccount;
  return (
    <div data-testid="wallet-cosign">
      <p className="hint">
        Real {info.network}. The held payments below are read from <code>{info.contractId}</code>. Approving asks your wallet to sign one <code>cosign</code> transaction as <code>{info.ownerAccount}</code>. No key is held by this site.
      </p>
      <div className="toolbar">
        {account ? (
          <>
            <p className="tally" data-testid="wallet-account">Connected as <b>{account}</b></p>
            <button className="btn ghost small" onClick={() => wallet.current?.disconnect()}>Disconnect</button>
          </>
        ) : (
          <button className="btn primary small" onClick={() => wallet.current?.connect()} data-testid="wallet-connect">Connect wallet <Icon name="ne" size={10} /></button>
        )}
        <button className="btn ghost small" onClick={loadHeld}><Icon name="refresh" /> Refresh</button>
      </div>
      {account && !isOwner && <ErrorNote>Only <b>{info.ownerAccount}</b> can approve. You are connected as {account}.</ErrorNote>}
      {back && (back.ok
        ? <p className="okay" role="status" data-testid="wallet-back"><Icon name="check" /> Approved on chain. {back.txHash && <a href={explorer(info.network, back.txHash)} target="_blank" rel="noreferrer">View the transaction <Icon name="ne" size={10} /></a>}</p>
        : <ErrorNote>The transaction landed but the contract refused it: {back.why}</ErrorNote>)}
      {error && <ErrorNote>{error}</ErrorNote>}
      {held && !held.length && !error && <p className="empty" data-testid="wallet-empty">Nothing is held on {info.network} right now. Held proposals expire after 15 minutes.</p>}
      <div className="helds">
        {held?.map((p) => {
          const r = results[p.proposalId];
          const done = r && r !== "sending" && r.ok;
          return (
            <article className={`hold-card ${done ? "finished" : ""}`} key={p.proposalId} data-testid={`chain-proposal-${p.proposalId}`}>
              <h2>{p.action.kind === "Transfer" ? `Send ${p.amountNear} NEAR to ${p.action.recipient}` : `Swap ${p.amountNear} NEAR into ${p.action.token}`}</h2>
              <dl>
                <dt>WHERE THE VALUE CAME FROM</dt><dd className="source">{p.sourceLine || "Your own instruction"}</dd>
                {p.diff && <><dt>LOOKALIKE CHECK</dt><dd className="warn">{p.diff}</dd></>}
              </dl>
              <div className="actions">
                <button className="btn primary" disabled={!isOwner || r === "sending" || !!done} onClick={() => approve(p, false)}>Approve once</button>
                {p.action.recipient && <button className="btn ghost" disabled={!isOwner || r === "sending" || !!done} onClick={() => approve(p, true)}>Approve and remember (cap 1 NEAR, 30 days)</button>}
              </div>
              {r === "sending" && <p className="hint" role="status">Waiting for your wallet...</p>}
              {r && r !== "sending" && (r.ok
                ? <p className="okay" role="status" data-testid="chain-approved"><Icon name="check" /> Approved on chain. {r.txHash && <a href={explorer(info.network, r.txHash)} target="_blank" rel="noreferrer" data-testid="chain-explorer">View the transaction <Icon name="ne" size={10} /></a>}</p>
                : <ErrorNote>{r.why}</ErrorNote>)}
            </article>
          );
        })}
      </div>
    </div>
  );
}
