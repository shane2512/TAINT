"use client";
import { useState } from "react";
import { api, ErrorNote, Icon, Outcome } from "./ui";
import type { AttemptView } from "../lib/data";

interface Row { id: string; outcome: string; fundsMovedWithoutCosign: boolean; byDesign: boolean; matchesExpect: boolean; paidTo?: string | null }
interface Summary { attempts: number; held: number; byDesign: number; failures: number; unexpected: number }

export default function RedteamRun({ attempts }: { attempts: AttemptView[] }) {
  const [rows, setRows] = useState<Record<string, Row> | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ rows: Row[]; summary: Summary }>("redteam", {});
      if (r.ok) { setRows(Object.fromEntries(r.body.rows.map((x) => [x.id, x]))); setSummary(r.body.summary); } else setError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setError("The runtime did not answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Run the red team">
      <div className="toolbar">
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? "Running" : rows ? "Run again" : "Run all twelve"} <Icon name="right" /></button>
        {summary && (
          <p className="tally" data-testid="redteam-summary">
            <b>{summary.held}</b> held or refused <b>{summary.byDesign}</b> moved by design <b className={summary.failures ? "red" : ""}>{summary.failures}</b> failures
          </p>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="table-wrap">
        <table data-testid="redteam">
          <thead><tr><th>ID</th><th>TECHNIQUE</th><th>RESULT</th><th>FUNDS MOVED WITHOUT CO-SIGN</th></tr></thead>
          <tbody>{attempts.map((a) => {
            const r = rows?.[a.id];
            return (
              <tr key={a.id} data-id={a.id}>
                <td className="num">{a.id}</td>
                <td>{a.technique}<span className="block-line sub">{a.note}</span></td>
                <td>{r ? <Outcome value={r.outcome} /> : <span className="sub">NOT RUN</span>}</td>
                <td>{r ? (r.fundsMovedWithoutCosign ? <span className={r.byDesign ? "" : "warn"}>{r.byDesign ? "Yes, by design" : "YES"}{r.paidTo ? `, to ${r.paidTo}` : ""}</span> : "No") : ""}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
