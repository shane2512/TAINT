import { describe, it, expect } from "vitest";
import { loadTable, runCase } from "../../bench/policy-runner";

// Runs bench/policy-cases.json, the rule table the Rust taint.near must also run.
const table = loadTable();

describe("shared policy rule table (bench/policy-cases.json)", () => {
  it("has the cases the Rust port must match", () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(15);
  });
  it("the runner reports a case that does not hold", () => {
    const wrong = { op: "propose" as const, id: "a", action: { kind: "Transfer", recipient: "alice.near", amountNear: "1" }, prov: { recipient: "owner", amount: "owner" }, expect: { Rejected: "nope" } };
    expect(runCase([wrong], table.config)).toHaveLength(1);
  });
  for (const c of table.cases) {
    it(c.name, () => expect(runCase(c.steps, table.config)).toEqual([]));
  }
});
