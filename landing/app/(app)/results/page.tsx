import ReplayRun from "../../../components/ReplayRun";
import { Outcome, PageHead } from "../../../components/ui";
import { fixtures, liveReplay } from "../../../lib/data";

const AGENTS = [["naive", "NAIVE"], ["allowlist", "ALLOWLIST+CAPS"], ["taint", "TAINT"]];
const TX = [
  ["Worker proposes a transfer from an outside source: held", "6khvLitRcJi74NsQwBt2tBmvjfuJtWKKLsj3xSbChEoU"],
  ["Relayer submits the owner's delegate: executed", "Hob69cKSdDtSXhS7eYYDp3Ds65yE6MXmBRxNAcrmHiAc"],
  ["The same delegate submitted again: rejected by nonce", "CXDDzMaZVw71CvEKGAUvvF3r6nTHCrjZvCLdwFHcLT7A"],
  ["Approved from the co-sign page: executed", "CquAtBH2iNFhqcjPQN5aULRoAq35FsjHhG2LNowEYAXg"],
];
const NOT_DONE = ["Mainnet: no transaction has run there.", "Wallet signing in the browser: the co-sign page uses a demo owner key.", "TEE attestation: stubbed. The worker is a plain registered key.", "Deleting the contract's full-access key: until then its holder can bypass the policy."];

export default function ResultsPage() {
  const r = liveReplay();
  const fx = fixtures();
  const ids = Object.keys(r.matrix);
  return (
    <div>
      <PageHead kicker="WHAT WE MEASURED / AND WHAT WE DID NOT" title="THE RESULTS.">
        Read from the saved run files when this site was built. One model, one provider, four fixtures chosen by the authors.
      </PageHead>

      <section className="block" aria-label="Live model replay">
        <h2 className="h-sm">LIVE-MODEL REPLAY</h2>
        <p className="hint">{r.model}, {r.runs} runs per fixture, {r.total} agent runs, {r.errors} error rows. The model was real and the payments were simulated. Saved {r.at.slice(0, 10)}.</p>
        <div className="table-wrap">
          <table data-testid="live-replay">
            <thead><tr><th>FIXTURE</th>{AGENTS.map(([, n]) => <th key={n}>{n}</th>)}</tr></thead>
            <tbody>{ids.map((id) => (
              <tr key={id} data-id={id}>
                <td><b className="num">{id}</b><span className="block-line sub">{fx.find((f) => f.id === id)?.title}</span></td>
                {AGENTS.map(([a]) => (
                  <td key={a}>{Object.entries(r.matrix[id][a]).map(([k, n]) => <span className="cellrow" key={k}><Outcome value={k} /> <span className="num">{n}/{r.runs}</span></span>)}</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="hint">TAINT&apos;s no-action rows are attack runs where the model did nothing or planned something the builder refused. They fail safe and cost utility, and they count as misses against the expected HELD.</p>
      </section>

      <ReplayRun />

      <section className="block" aria-label="On testnet">
        <h2 className="h-sm">ON TESTNET</h2>
        <p className="hint">The contract and the NEP-366 co-sign flow, run against NEAR testnet.</p>
        <ul className="plain" data-testid="tx-list">{TX.map(([t, h]) => <li key={h}><span>{t}</span><a href={`https://testnet.nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer">{h.slice(0, 8)}...</a></li>)}</ul>
      </section>

      <section className="block" aria-label="Not done">
        <h2 className="h-sm">NOT DONE</h2>
        <ul className="plain" data-testid="not-done">{NOT_DONE.map((n) => <li key={n}><span>{n}</span></li>)}</ul>
      </section>
    </div>
  );
}
