"use client";
import { useCallback, useEffect, useState } from "react";

type IconName = "ne" | "up" | "down" | "right" | "lr" | "logo" | "check" | "x" | "refresh";
// Drawn on a 12px grid in square steps, to match the pixel type.
const PATHS: Record<IconName, string> = {
  ne: "M4 2h6v6H8V5.4L3.4 10 2 8.6 6.6 4H4z",
  up: "M5 11V4.8L3 6.8 1.6 5.4 6 1l4.4 4.4L9 6.8l-2-2V11z",
  down: "M5 1v6.2l-2-2L1.6 6.6 6 11l4.4-4.4L9 5.2l-2 2V1z",
  right: "M1 5h6.2l-2-2L6.6 1.6 11 6l-4.4 4.4L5.2 9l2-2H1z",
  lr: "M4 2 0 6l4 4V7h4v3l4-4-4-4v3H4z",
  logo: "M1 1h10v10H1zm2 2v6h6V3zm1.5 1.5h3v3h-3z",
  check: "M1 6.5 2.4 5l2.3 2.3L9.6 2.4 11 3.8 4.7 10z",
  x: "M2.4 1 6 4.6 9.6 1 11 2.4 7.4 6 11 9.6 9.6 11 6 7.4 2.4 11 1 9.6 4.6 6 1 2.4z",
  refresh: "M6 1a5 5 0 0 1 4.6 3H12L9.5 7 7 4h1.4A3 3 0 1 0 9 8l1.7 1A5 5 0 1 1 6 1z",
};
export function Icon({ name, size = 12 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 12 12" fill="currentColor" fillRule="evenodd" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}

export interface ApiResult<T> { ok: boolean; status: number; body: T & { error?: string; offline?: boolean } }
export async function api<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch("/api/" + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

export interface Preset { id: string; title: string; kind: "attack" | "legit"; instruction: string; attachments: { source: string; text: string }[] }
export interface Meta { banner: string; network: string; mode: string; publicDemo?: boolean; presets: Preset[] }

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (n: number) => {
      try {
        const r = await api<Meta & { waking?: boolean }>("meta");
        if (stop) return;
        if (r.ok) { setMeta(r.body); setOffline(null); return; }
        setOffline(r.body.error ?? "The runtime did not answer.");
        if ((r.body as { waking?: boolean }).waking && n < 12) timer = setTimeout(() => attempt(n + 1), 6000);
      } catch {
        if (!stop) setOffline("The runtime did not answer.");
      }
    };
    void attempt(0);
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return { meta, offline };
}

/** A GET that can be reloaded, with loading and error states. */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<T>(path);
      if (r.ok) { setData(r.body); setError(null); } else setError(r.body.error ?? `Request failed (${r.status})`);
    } catch {
      setError("The runtime did not answer.");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <p className="eyebrow">{kicker}</p>
      <div className="titlebar">
        <h1>{title}</h1>
        {children && <div className="aside">{children}</div>}
      </div>
    </header>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="error" role="alert"><Icon name="x" /> {children}</p>;
}

export const OUTCOME: Record<string, { word: string; cls: string }> = {
  drained: { word: "DRAINED", cls: "bad" },
  blocked: { word: "BLOCKED", cls: "dim" },
  pending: { word: "HELD", cls: "held" },
  held: { word: "HELD", cls: "held" },
  ok: { word: "DONE", cls: "good" },
  executed: { word: "EXECUTED", cls: "good" },
  rejected: { word: "REJECTED", cls: "dim" },
  "no-action": { word: "NO ACTION", cls: "dim" },
  none: { word: "NO ACTION", cls: "dim" },
  error: { word: "ERROR", cls: "bad" },
  "refused-at-signing": { word: "REFUSED", cls: "dim" },
};
export function Outcome({ value }: { value: string }) {
  const o = OUTCOME[value] ?? { word: value.toUpperCase(), cls: "dim" };
  return <span className={`pill ${o.cls}`} data-outcome={value}>{o.word}</span>;
}
