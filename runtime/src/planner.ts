import { createHash } from "node:crypto";
import { complete } from "./llm";
import type { HandleSummary } from "./handles";

export type ArgRef = { literal: string } | { handle: string };

export interface PlannedAction {
  kind: "Transfer" | "Swap" | "None";
  recipient: ArgRef | null;
  token: ArgRef | null;
  amount: ArgRef | null;
}

const NONE: PlannedAction = { kind: "None", recipient: null, token: null, amount: null };

const SYSTEM =
  "Turn the owner's instruction into one action. You see only the owner's text and a list of handles: " +
  "opaque references (id, kind, coarse source) to values read from outside content. Refer to a handle by id. " +
  "Use a literal only for a value the owner wrote. Never invent values. " +
  'Return JSON {"kind":"Transfer"|"Swap"|"None","recipient":ref|null,"token":ref|null,"amount":ref|null} ' +
  'where ref is {"literal":string} or {"handle":string}.';

const REF = {
  anyOf: [
    { type: "null" },
    { type: "object", properties: { literal: { type: "string" } }, required: ["literal"], additionalProperties: false },
    { type: "object", properties: { handle: { type: "string" } }, required: ["handle"], additionalProperties: false },
  ],
};

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["Transfer", "Swap", "None"] },
    recipient: REF,
    token: REF,
    amount: REF,
  },
  required: ["kind", "recipient", "token", "amount"],
  additionalProperties: false,
};

export function plannerRecordingKey(instruction: string, handles: HandleSummary[]): string {
  return "planner:" + createHash("sha256").update(instruction + JSON.stringify(handles)).digest("hex").slice(0, 12);
}

const BAD = Symbol("bad");

function ref(v: unknown): ArgRef | null | typeof BAD {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o.literal === "string") return { literal: o.literal };
    if (keys.length === 1 && typeof o.handle === "string") return { handle: o.handle };
  }
  return BAD;
}

export async function plan(instruction: string, handles: HandleSummary[]): Promise<PlannedAction> {
  const out = await complete({
    role: "planner",
    system: SYSTEM,
    user: `INSTRUCTION: ${instruction}\nHANDLES: ${JSON.stringify(handles)}`,
    jsonSchema: SCHEMA,
    recordingKey: plannerRecordingKey(instruction, handles),
  });
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(out);
  } catch {
    return NONE;
  }
  if (typeof o !== "object" || o === null) return NONE;
  if (o.kind !== "Transfer" && o.kind !== "Swap" && o.kind !== "None") return NONE;
  const recipient = ref(o.recipient);
  const token = ref(o.token);
  const amount = ref(o.amount);
  if (recipient === BAD || token === BAD || amount === BAD) return NONE;
  return { kind: o.kind, recipient, token, amount };
}
