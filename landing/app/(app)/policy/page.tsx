import PolicyDesk from "../../../components/PolicyDesk";
import PolicyCases from "../../../components/PolicyCases";
import { PageHead } from "../../../components/ui";
import { policyCaseCount } from "../../../lib/data";

export default function PolicyPage() {
  const n = policyCaseCount();
  return (
    <div>
      <PageHead title="The policy.">
        Build a proposal and say where each value came from. The answer comes from the TypeScript implementation of the contract&apos;s rules, run fresh each time. Twenty-four shared cases check it against the Rust contract.
      </PageHead>
      <PolicyDesk caseCount={n} />
      <PolicyCases />
    </div>
  );
}
