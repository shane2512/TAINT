import Shell from "../components/Shell";
import { Intro, Demo, Workflow, Features, Interface, Privacy, Benchmark, Ecosystem, Faq, Install } from "../components/Sections";
import { fixtures, liveRedteams, liveReplay, policyCaseCount } from "../lib/data";

export default function Page() {
  const caseCount = policyCaseCount();
  return (
    <Shell>
      <Intro caseCount={caseCount} /><Demo fixtures={fixtures()} /><Workflow /><Features /><Interface caseCount={caseCount} /><Privacy />
      <Benchmark replay={liveReplay()} redteams={liveRedteams()} /><Ecosystem /><Faq /><Install />
    </Shell>
  );
}
