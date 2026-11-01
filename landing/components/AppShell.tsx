"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErrorNote, Icon, useMeta, type Meta } from "./ui";
import { Foot } from "./Sections";

const NAV = [
  ["ROB THE PET", "/demo"],
  ["CO-SIGN", "/cosign"],
  ["WALLET", "/wallet"],
  ["POLICY", "/policy"],
  ["RED TEAM", "/redteam"],
  ["RESULTS", "/results"],
];

const MetaCtx = createContext<Meta | null>(null);
export const useSharedMeta = () => useContext(MetaCtx);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { meta, offline } = useMeta();
  return (
    <div className="app">
      <header className="nav">
        <Link className="brand" href="/"><Icon name="logo" size={14} /> taint.testnet <span className="ver">V0.1.0</span></Link>
        <nav aria-label="App">
          {NAV.map(([t, h]) => <Link key={h} href={h} className={path === h ? "on" : ""} aria-current={path === h ? "page" : undefined}>{t}</Link>)}
        </nav>
      </header>
      {/* The banner stays on every page: MOCK mode or a stubbed attestation must never be hidden. */}
      <p className={`status ${offline ? "off" : ""}`} role="status" data-testid="banner">{offline ?? meta?.banner ?? "CONNECTING TO THE RUNTIME"}</p>
      <main className="app-main">
        {offline && <ErrorNote>This page needs the runtime. Start it in another terminal with <code>npm run web</code>, then reload.</ErrorNote>}
        <MetaCtx.Provider value={meta}>{children}</MetaCtx.Provider>
      </main>
      <div className="light app-foot"><Foot /></div>
    </div>
  );
}
