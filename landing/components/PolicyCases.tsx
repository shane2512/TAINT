"use client";
import { ErrorNote, Icon, useApi } from "./ui";

interface Case { name: string; steps: number; pass: boolean; failures: string[] }

export default function PolicyCases() {
  const { data, error, loading, reload } = useApi<Case[]>("policy/cases");
  const passed = data?.filter((c) => c.pass).length ?? 0;
  return (
    <section className="block" aria-label="Shared rule table">
      <div className="block-head">
        <h2 className="h-sm">Shared rule table</h2>
        <button className="btn ghost small" onClick={reload} disabled={loading}><Icon name="refresh" /> {loading ? "Running" : "Run again"}</button>
      </div>
      <p className="hint">bench/policy-cases.json. The TypeScript mock runs it here. <code>npm run test:contract</code> runs the same file against the Rust contract.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <>
          <p className="big" data-testid="cases-summary">{passed} <small>OF {data.length} PASS</small></p>
          <div className="table-wrap">
            <table data-testid="cases">
              <thead><tr><th>CASE</th><th className="r">STEPS</th><th className="r">RESULT</th></tr></thead>
              <tbody>{data.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}{c.failures.map((f) => <span key={f} className="warn block-line">{f}</span>)}</td>
                  <td className="num r">{c.steps}</td>
                  <td className="r"><span className={`pill ${c.pass ? "good" : "bad"}`}>{c.pass ? "PASS" : "FAIL"}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
