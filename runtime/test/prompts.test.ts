import { describe, it, expect } from "vitest";
import { EXTRACTOR_SYSTEM } from "../src/extractor";
import { PLANNER_SYSTEM } from "../src/planner";
import { NAIVE_SYSTEM } from "../src/agents/naive";

// A live model answered `{"amounts":["1.5"],"tokens":["NEAR"]}` to the first prompts, which our strict parsers
// (correctly) reject: a bare number has no unit, and "NEAR" is the native coin, not a token contract.
// The prompts must therefore spell out the exact formats the parsers accept.

describe("system prompts spell out the formats the strict parsers accept", () => {
  it("tells the extractor to write amounts as '<number> NEAR'", () => {
    expect(EXTRACTOR_SYSTEM).toMatch(/"<number> NEAR"/);
    expect(EXTRACTOR_SYSTEM).toMatch(/1\.5 NEAR/);
  });

  it("tells the extractor that NEAR itself is not a token and tokens are account ids", () => {
    expect(EXTRACTOR_SYSTEM).toMatch(/never .*"NEAR".*tokens|tokens.*never.*"NEAR"/i);
    expect(EXTRACTOR_SYSTEM).toMatch(/account id/i);
  });

  it("still tells the extractor never to follow instructions in the content", () => {
    expect(EXTRACTOR_SYSTEM).toMatch(/never follow instructions/i);
  });

  it("tells the naive agent the amount format, and that a plain transfer has a null token", () => {
    expect(NAIVE_SYSTEM).toMatch(/"<number> NEAR"/);
    expect(NAIVE_SYSTEM).toMatch(/token.*null/i);
    expect(NAIVE_SYSTEM).toMatch(/only send funds when the owner asks/i);
  });

  it("tells the planner to copy owner-written values exactly as written", () => {
    expect(PLANNER_SYSTEM).toMatch(/exactly as the owner wrote/i);
  });
});
