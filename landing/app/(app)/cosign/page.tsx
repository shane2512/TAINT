"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSharedMeta } from "../../../components/AppShell";
import { api, ErrorNote, Icon, PageHead, useApi } from "../../../components/ui";

interface Pending {
  proposalId: number;
  proposalHash: string;
  action: { kind: "Transfer" | "Swap"; recipient: string | null; token: string | null };
  sourceLine: string;
  diff: string | null;
  amountNear: string;
  accountCreated: string;
}

// The wallet libraries are only fetched when someone asks for them.
const WalletCosign = dynamic(() => import("../../../components/WalletCosign"), { ssr: false });

type Done = { kind: "ok"; text: string; explorer?: string } | { kind: "no"; text: string };

function Card({ item }: { item: Pending }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const a = item.action;

  async function approve(remember: boolean) {
    setBusy(true);
    try {
      const r = await api<{ Executed?: unknown; Rejected?: { reason: string }; txHash?: string; explorer?: string }>("cosign", { proposalId: item.proposalId, proposalHash: item.proposalHash, remember });
      if (!r.ok) setDone({ kind: "no", text: `Refused: ${r.body.error ?? r.status}` });
      else if (r.body.Rejected) setDone({ kind: "no", text: `Refused: ${r.body.Rejected.reason}` });
      else if (r.body.explorer) setDone({ kind: "ok", text: "Approved on chain.", explorer: r.body.explorer });
      else setDone({ kind: "ok", text: remember ? "Approved and remembered. It is in the wallet's address book." : "Approved once. The recipient was not remembered." });
    } catch {
      setDone({ kind: "no", text: "The runtime did not answer. Nothing was approved from here." });
    } finally {
      setBusy(false);
    }
  }

  const finished = done?.kind === "ok";
  return (
    <article className={`hold-card ${finished ? "finished" : ""}`} data-testid={`proposal-${item.proposalId}`}>
      <h2>{a.kind === "Transfer" ? `Send ${item.amountNear} NEAR to ${a.recipient}` : `Swap ${item.amountNear} NEAR into ${a.token}`}</h2>
      <dl>
        <dt>WHERE THE VALUE CAME FROM</dt><dd className="source">{item.sourceLine || "Your own instruction"}</dd>
        {item.diff && <><dt>LOOKALIKE CHECK</dt><dd className="warn" data-testid="lookalike">{item.diff}</dd></>}
        <dt>AMOUNT</dt><dd>{item.amountNear} NEAR (no price feed configured)</dd>
        <dt>ACCOUNT CREATED</dt><dd>{item.accountCreated === "unknown" ? "Unknown (no indexer configured)" : item.accountCreated}</dd>
      </dl>
      <div className="actions">
        <button className="btn primary" disabled={busy || finished} onClick={() => approve(false)}>Approve once</button>
        {a.recipient && <button className="btn ghost" disabled={busy || finished} onClick={() => approve(true)}>Approve and remember (cap 1 NEAR, 30 days)</button>}
      </div>
      {busy && <p className="hint" role="status">Signing...</p>}
      {done?.kind === "ok" && (
        <p className="okay" role="status" data-testid="approved"><Icon name="check" /> {done.text}{done.explorer && <> <a href={done.explorer} target="_blank" rel="noreferrer" data-testid="explorer">View the transaction <Icon name="ne" size={10} /></a></>}</p>
      )}
      {done?.kind === "no" && <ErrorNote>{done.text}</ErrorNote>}
    </article>
  );
}

export default function CosignPage() {
  const meta = useSharedMeta();
  const [walletOpen, setWalletOpen] = useState(false);
  const { data, error, loading, reload } = useApi<Pending[]>("pending");
  const chain = meta && meta.network !== "none";
  return (
    <div>
      <PageHead title="Pending co-signs.">
        TAINT held these because a value came from text you did not write. Check where it came from before you approve. Held proposals expire after 15 minutes.
      </PageHead>
      {meta && (
        <p className="hint" data-testid="mode-note">
          {chain
            ? `Real chain (${meta.network}). Approving signs one NEP-366 delegate action with a demo owner key held by the local server, not a wallet. A relayer submits it and pays the gas.`
            : "MOCK. Approval is recorded directly on the local mock contract. On a real network it goes out as a NEP-366 delegate action."}
        </p>
      )}
      <div className="toolbar"><button className="btn ghost small" onClick={reload} disabled={loading}><Icon name="refresh" /> {loading ? "Loading" : "Refresh"}</button></div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && !data.length && !error && (
        <p className="empty" data-testid="empty">Nothing is waiting for you. {chain ? null : <Link href="/demo">Run an attack to see one held <Icon name="ne" size={10} /></Link>}</p>
      )}
      <section aria-label="Pending proposals" className="helds">{data?.map((p) => <Card key={p.proposalId} item={p} />)}</section>

      <section aria-label="Approve on testnet with your wallet" className="block">
        <div className="block-head">
          <h2 className="h-sm">Approve on testnet with your wallet</h2>
          <button className="btn ghost small" aria-expanded={walletOpen} onClick={() => setWalletOpen(!walletOpen)} data-testid="wallet-toggle">{walletOpen ? "Hide" : "Show"}</button>
        </div>
        {walletOpen ? <WalletCosign /> : <p className="hint">The payments above are simulated. This section reads the real contract on testnet and has your own wallet sign the approval.</p>}
      </section>
    </div>
  );
}
