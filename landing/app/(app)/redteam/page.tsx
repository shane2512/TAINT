import RedteamRun from "../../../components/RedteamRun";
import { PageHead } from "../../../components/ui";
import { attempts, liveRedteams } from "../../../lib/data";

export default function RedteamPage() {
  return (
    <div>
      <PageHead title="The red team.">
        This run assumes the model believed every attack and hands it the attacker&apos;s output. It tests the deterministic layers: parsers, handle typing, literal grounding and the contract gate.
      </PageHead>
      <RedteamRun attempts={attempts()} />
      <section className="block" aria-label="Saved live runs">
        <h2 className="h-sm">Saved live-model runs</h2>
        <p className="hint">A real model, not told it was being attacked, with simulated payments. Error rows are API failures and say nothing either way, so neither run is a clean full measurement.</p>
        <div className="table-wrap">
          <table data-testid="live-redteam">
            <thead><tr><th>MODEL</th><th className="r">ATTEMPTS</th><th className="r">HELD, REFUSED OR NO ACTION</th><th className="r">MOVED BY DESIGN</th><th className="r">FAILURES</th><th className="r">API ERROR ROWS</th><th>FILE</th></tr></thead>
            <tbody>{liveRedteams().map((r) => (
              <tr key={r.file}><td>{r.model}</td><td className="num r">{r.attempts}</td><td className="num r">{r.held}</td><td className="num r">{r.byDesign}</td><td className="num r">{r.failures}</td><td className="num r">{r.errors}</td><td>bench/results/{r.file}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
