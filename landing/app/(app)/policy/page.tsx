import PolicyDesk from "../../../components/PolicyDesk";
import PolicyCases from "../../../components/PolicyCases";
import { PageHead } from "../../../components/ui";
import { policyCaseCount } from "../../../lib/data";

export default function PolicyPage() {
  const n = policyCaseCount();
  return (
    <div>
      <PageHead kicker="THE RULES / TRY ANY PROPOSAL" title="The policy.">
        Build a proposal and say where each value came from. The answer comes from the real rules, on a fresh mock contract each time.
      </PageHead>
      <PolicyDesk caseCount={n} />
      <PolicyCases />
    </div>
  );
}
