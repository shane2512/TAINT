"use client";
import { useState } from "react";
import { api, ErrorNote, PageHead, useApi } from "../../../components/ui";

interface Entry { address: string; capNear: string; expiresAt: number; learnedFrom: string }
interface Wallet { network: string; writable: boolean; book: Entry[]; pins: string[]; spent24hNear: string; globalCapNear: string | null }

const OWNER_CALLS = [
  ["set_paused", "Stop every payment"],
  ["remove_worker", "Revoke a leaked worker key"],
  ["withdraw", "Take funds out faster than the cap"],
  ["set_config", "Change the caps and expiries"],
];

export default function WalletPage() {
  const { data: w, error: loadError, reload, setData } = useApi<Wallet>("wallet");
  const [address, setAddress] = useState("");
  const [cap, setCap] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function write(op: string, body: object): Promise<boolean> {
    setError(null);
    try {
      const r = await api<Wallet>(`wallet/${op}`, body);
      if (r.ok) { setData(r.body); return true; }
      setError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setError("The runtime did not answer.");
    }
    return false;
  }

  const pct = w?.globalCapNear ? Math.min(100, (Number(w.spent24hNear) / Number(w.globalCapNear)) * 100) : 0;
  return (
    <div>
      <PageHead title="The wallet.">
        A recipient in the address book or registered by a pinned account can be paid inside its cap. Everything else waits for a co-sign.
      </PageHead>
      {loadError && <ErrorNote>{loadError}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {w && (
        <>
          <section className="meter" aria-label="Spent in the last 24 hours" data-testid="meter">
            <p className="gl">SPENT IN THE LAST 24 HOURS</p>
            <p className="big"><span data-testid="spent">{w.spent24hNear}</span>{w.globalCapNear && <small> / {w.globalCapNear} NEAR</small>}{!w.globalCapNear && <small> NEAR</small>}</p>
            {w.globalCapNear && <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the daily cap used"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>}
            {!w.writable && <p className="hint" data-testid="readonly">Read from {w.network}. Owner calls are not exposed on this page.</p>}
          </section>

          <div className="cols">
            <section aria-label="Address book" className="block">
              <h2 className="h-sm">Address book</h2>
              {w.writable && (
                <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (await write("remember", { address, capNear: cap || undefined })) { setAddress(""); setCap(""); } }}>
                  <label><span className="gl">ACCOUNT</span><input className="txt" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="vendor.testnet" spellCheck={false} /></label>
                  <label><span className="gl">CAP (NEAR)</span><input className="txt" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="1" inputMode="decimal" /></label>
                  <button className="btn primary small" disabled={!address.trim()}>Remember</button>
                </form>
              )}
              {w.book.length ? (
                <div className="table-wrap">
                  <table data-testid="book">
                    <thead><tr><th>ACCOUNT</th><th>CAP</th><th>EXPIRES</th><th>LEARNED FROM</th>{w.writable && <th><span className="vh">Actions</span></th>}</tr></thead>
                    <tbody>{w.book.map((e) => (
                      <tr key={e.address}>
                        <td>{e.address}</td><td className="num">{e.capNear} NEAR</td><td className="num">{new Date(e.expiresAt).toISOString().slice(0, 10)}</td><td>{e.learnedFrom}</td>
                        {w.writable && <td className="r"><button className="link" onClick={() => write("forget", { address: e.address })} aria-label={`Forget ${e.address}`}>Forget</button></td>}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="empty" data-testid="book-empty">The address book is empty. Approve and remember a held payment, or add one here.</p>}
            </section>

            <section aria-label="Pinned accounts" className="block">
              <h2 className="h-sm">Pinned accounts</h2>
              {w.writable && (
                <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (await write("pin", { address: pin })) setPin(""); }}>
                  <label><span className="gl">ACCOUNT</span><input className="txt" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="acme.testnet" spellCheck={false} /></label>
                  <button className="btn primary small" disabled={!pin.trim()}>Pin</button>
                </form>
              )}
              {w.pins.length ? (
                <ul className="plain" data-testid="pins">{w.pins.map((p) => <li key={p}><span>{p}</span>{w.writable && <button className="link" onClick={() => write("unpin", { address: p })} aria-label={`Unpin ${p}`}>Unpin</button>}</li>)}</ul>
              ) : <p className="empty" data-testid="pins-empty">No pinned accounts. A pinned account can register payee addresses, capped at 0.5 NEAR for their first 24 hours.</p>}
            </section>
          </div>

          <section className="block" aria-label="Owner calls">
            <h2 className="h-sm">Only on the Rust contract</h2>
            <p className="hint">These owner calls exist on the deployed contract and are not on this page, so there are no buttons for them here.</p>
            <ul className="plain">{OWNER_CALLS.map(([c, d]) => <li key={c}><code>{c}</code><span>{d}</span></li>)}</ul>
          </section>
          <button className="btn ghost small" onClick={reload}>Refresh</button>
        </>
      )}
    </div>
  );
}
