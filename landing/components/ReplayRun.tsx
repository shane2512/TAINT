"use client";
import { useState } from "react";
import { api, ErrorNote, Icon, Outcome } from "./ui";

interface Row { fixture: string; agent: string; outcome: string; expected: string; matchesExpect: boolean }

export default function ReplayRun() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ rows: Row[] }>("replay", {});
      if (r.ok) setRows(r.body.rows); else setError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setError("The runtime did not answer.");
    } finally {
      setBusy(false);
    }
  }

  const fixtures = [...new Set(rows?.map((r) => r.fixture))];
  const cell = (f: string, a: string) => rows!.find((r) => r.fixture === f && r.agent === a)!;
  return (
    <section className="block" aria-label="Mock replay">
      <div className="block-head">
        <h2 className="h-sm">MOCK REPLAY</h2>
        <button className="btn ghost small" onClick={run} disabled={busy}>{busy ? "RUNNING" : "RUN IT NOW"} <Icon name="right" /></button>
      </div>
      <p className="hint">Hand-authored model answers on all five fixtures. It checks the code against its declared expectations. It says nothing about how a real model behaves.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {rows && (
        <>
          <p className="big" data-testid="replay-summary">{rows.filter((r) => r.matchesExpect).length} <small>OF {rows.length} MATCH THEIR EXPECTATION</small></p>
          <div className="table-wrap">
            <table data-testid="mock-replay">
              <thead><tr><th>FIXTURE</th><th>NAIVE</th><th>ALLOWLIST+CAPS</th><th>TAINT</th></tr></thead>
              <tbody>{fixtures.map((f) => (
                <tr key={f}><td className="num">{f}</td>{["naive", "allowlist", "taint"].map((a) => <td key={a}><Outcome value={cell(f, a).outcome} /></td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
