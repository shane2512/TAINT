import { mode } from "./llm";

/** True unless ATTESTATION=real. A stub means no TEE attestation backs the worker key. */
export function attestationStubbed(): boolean {
  return (process.env.ATTESTATION ?? "stub") !== "real";
}

/** First line of every CLI output, so a weaker trust claim is never silent. */
export function banner(network: string): string {
  return `[taint] network=${network} mode=${mode()}` + (attestationStubbed() ? " ATTESTATION STUBBED" : "");
}
