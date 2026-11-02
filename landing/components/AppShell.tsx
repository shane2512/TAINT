"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErrorNote, Icon, Mark, useMeta, type Meta } from "./ui";
import { Footer } from "./Sections";

const NAV = [
  ["Rob the Pet", "/demo"],
  ["Co-sign", "/cosign"],
  ["Wallet", "/wallet"],
  ["Policy", "/policy"],
  ["Red team", "/redteam"],
  ["Results", "/results"],
];

const MetaCtx = createContext<Meta | null>(null);
export const useSharedMeta = () => useContext(MetaCtx);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { meta, offline } = useMeta();
  return (
    <div className="app">
      <header className="nav">
        <Link className="brand" href="/"><Mark size={24} /><span>TAINT</span></Link>
        <nav aria-label="App">
          {NAV.map(([t, h]) => <Link key={h} href={h} aria-current={path === h ? "page" : undefined}>{t}</Link>)}
        </nav>
        <div className="nav-cta"><Link className="btn ghost small" href="/"><Icon name="up" size={12} /> Home</Link></div>
      </header>
      {/* The banner stays on every page: MOCK mode or a stubbed attestation must never be hidden. */}
      <p className={`status ${offline ? "off" : ""}`} role="status" data-testid="banner">{offline ?? meta?.banner ?? "Connecting to the runtime"}</p>
      <main className="app-main">
        {offline && <ErrorNote>This page needs the runtime. Start it in another terminal with <code>npm run web</code>, then reload.</ErrorNote>}
        <MetaCtx.Provider value={meta}>{children}</MetaCtx.Provider>
      </main>
      <Footer compact />
    </div>
  );
}
