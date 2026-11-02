import { describe, it, expect } from "vitest";
import { failureOf } from "../src/relayer";

const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64");
const receipt = (status: unknown) => ({ outcome: { status } });

describe("failureOf: what a relayed co-sign really did", () => {
  it("reports nothing when the contract executed the payment", () => {
    const res = { status: { SuccessValue: "" }, receipts_outcome: [receipt({ SuccessValue: "" }), receipt({ SuccessValue: b64({ Executed: { proposal_id: 3 } }) })] };
    expect(failureOf(res)).toBeUndefined();
  });

  it("reports a contract refusal that still came back as a successful call", () => {
    const res = { status: { SuccessValue: "" }, receipts_outcome: [receipt({ SuccessValue: b64({ Rejected: { reason: "global cap exceeded" } }) })] };
    expect(failureOf(res)).toBe("contract refused: global cap exceeded");
  });

  it("reports a failed receipt, such as a reused delegate nonce", () => {
    const res = { status: { Failure: { DelegateActionInvalidNonce: {} } }, receipts_outcome: [] };
    expect(failureOf(res)).toContain("DelegateActionInvalidNonce");
  });

  it("reports a failure inside a later receipt when the first ones succeeded", () => {
    const res = { status: { SuccessValue: "" }, receipts_outcome: [receipt({ SuccessValue: "" }), receipt({ Failure: { ActionError: { kind: { FunctionCallError: "x" } } } })] };
    expect(failureOf(res)).toContain("ActionError");
  });

  it("ignores return values that are not JSON or not an outcome", () => {
    const res = { status: { SuccessValue: "" }, receipts_outcome: [receipt({ SuccessValue: b64("not json {") }), receipt({ SuccessValue: b64({ hello: 1 }) }), receipt({ SuccessValue: b64(null) })] };
    expect(failureOf(res)).toBeUndefined();
  });

  it("copes with a response that has no receipts", () => {
    expect(failureOf({ status: { SuccessValue: "" } })).toBeUndefined();
  });
});
