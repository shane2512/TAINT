import Shell from "../components/Shell";
import { Cta, Faq, Footer, Hero, How, Modes, Results, type ResultStats } from "../components/Sections";
import { liveRedteams, liveReplay, policyCaseCount, type LiveReplay } from "../lib/data";

function count(r: LiveReplay, agent: string, kind: "F" | "L", outcome: string) {
  let n = 0, of = 0;
  for (const [fx, row] of Object.entries(r.matrix)) {
    if (!fx.startsWith(kind)) continue;
    for (const [k, c] of Object.entries(row[agent] ?? {})) { of += c; if (k === outcome) n += c; }
  }
  return { n, of };
}

export default function Page() {
  const r = liveReplay();
  const held = count(r, "taint", "F", "pending");
  const legit = count(r, "taint", "L", "ok");
  const red = liveRedteams();
  const stats: ResultStats = {
    held: held.n, heldOf: held.of, legit: legit.n, legitOf: legit.of,
    redFail: red.reduce((a, x) => a + x.failures, 0), redOf: red.reduce((a, x) => a + x.attempts, 0),
    cases: policyCaseCount(),
  };
  return (
    <Shell>
      <Hero /><How /><Modes /><Results s={stats} /><Faq /><Cta /><Footer />
    </Shell>
  );
}
