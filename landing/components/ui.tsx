"use client";
import { useCallback, useEffect, useState } from "react";

type IconName = "ne" | "up" | "down" | "right" | "lr" | "logo" | "check" | "x" | "refresh" | "plus" | "minus" | "github" | "chev";
// Line icons on a 24 grid, one stroke weight throughout.
const LINES: Record<Exclude<IconName, "logo" | "github">, string> = {
  ne: "M7 17 17 7M8 7h9v9",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  right: "M4 12h16M14 6l6 6-6 6",
  lr: "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chev: "M6 9l6 6 6-6",
};
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  if (name === "logo") return <Mark size={size} />;
  if (name === "github") return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>;
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={LINES[name]} /></svg>;
}

/** The TAINT mark: a T whose stem carries a drop of ink, the part that came from outside. Sized in px, or in em with a string. */
export function Mark({ size = 22 }: { size?: number | string }) {
  const d = typeof size === "number" ? `${size}px` : size;
  return (
    <svg className="mark" width={d} height={d} viewBox="0 0 24 24" aria-hidden="true" style={{ width: d, height: d }}>
      <rect x="2" y="3" width="20" height="5" rx="1" fill="currentColor" />
      <rect x="9.5" y="8" width="5" height="9" fill="currentColor" />
      <circle cx="12" cy="20" r="2.6" fill="#ec4a14" />
    </svg>
  );
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

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
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
