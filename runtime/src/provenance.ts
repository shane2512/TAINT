import type { ArgProvenance } from "./proposal";

/** "recipient <- x.com/@attacker; amount <- ..." for the arguments that came from untrusted content. */
export function provenanceLine(p: ArgProvenance | undefined): string {
  if (!p) return "";
  return (["recipient", "token", "amount"] as const)
    .filter((k) => p[k]?.class === "Untrusted")
    .map((k) => `${k} <- ${p[k]!.source}`)
    .join("; ");
}
