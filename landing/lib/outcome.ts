// What a signed `cosign` transaction really did. A transaction can land and every receipt can succeed while the
// contract still refused the payment: it answers {Rejected: {reason}} (for example over the daily cap) as an ordinary
// return value. The same check lives in runtime/src/relayer.ts (failureOf) for the relayed path.
export type Outcome = { ok: true; txHash?: string } | { ok: false; why: string; txHash?: string };

interface Status { Failure?: unknown; SuccessValue?: string }
interface Final { status?: Status; receipts_outcome?: { outcome?: { status?: Status } }[]; transaction?: { hash?: string } }

export function outcomeOf(o: Final | undefined | null): Outcome {
  const txHash = o?.transaction?.hash;
  const statuses = [o?.status, ...(o?.receipts_outcome ?? []).map((r) => r.outcome?.status)];
  for (const st of statuses) {
    if (st?.Failure) return { ok: false, why: JSON.stringify(st.Failure), txHash };
    if (st?.SuccessValue) {
      try {
        const v = JSON.parse(atob(st.SuccessValue));
        if (v && typeof v === "object" && v.Rejected) return { ok: false, why: `contract refused: ${v.Rejected.reason}`, txHash };
      } catch {
        // a return value that is not JSON is not an outcome
      }
    }
  }
  return { ok: true, txHash };
}
