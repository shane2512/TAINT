export type HandleKind = "Account" | "Token" | "Amount";

export interface Handle {
  id: string;
  kind: HandleKind;
  value: string;
  source: string;
}

/** What the planner may see: no value, and only a coarse source label. */
export interface HandleSummary {
  id: string;
  kind: HandleKind;
  source: string;
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const YOCTO = 10n ** 24n;

export function parseAccount(raw: string): string | null {
  const s = raw.trim();
  if (/[^\x00-\x7f]/.test(s)) return null; // reject lookalikes before lowercasing
  const a = s.toLowerCase();
  return a.length >= 2 && a.length <= 64 && ACCOUNT_RE.test(a) ? a : null;
}

export function parseAmountYocto(raw: string): string | null {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return BigInt(s).toString();
  const m = /^(\d+)(?:\.(\d{1,24}))?\s*NEAR$/i.exec(s);
  if (!m) return null;
  return (BigInt(m[1]) * YOCTO + BigInt((m[2] ?? "").padEnd(24, "0"))).toString();
}

function coarseSource(source: string): string {
  return source.split(/[/@]/)[0].toLowerCase().replace(/[^a-z0-9.:-]/g, "").slice(0, 32);
}

export class HandleStore {
  private items: Handle[] = [];

  add(kind: HandleKind, value: string, source: string): Handle {
    const h = { id: `$h${this.items.length + 1}`, kind, value, source };
    this.items.push(h);
    return h;
  }

  get(id: string): Handle {
    const h = this.items.find((x) => x.id === id);
    if (!h) throw new Error(`unknown handle ${id}`);
    return h;
  }

  summaries(): HandleSummary[] {
    return this.items.map(({ id, kind, source }) => ({ id, kind, source: coarseSource(source) }));
  }
}
