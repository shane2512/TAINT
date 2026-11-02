"use client";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Mark } from "./ui";

// The product window in the hero and again near the bottom. Everything in it is sample data, and says so.
export function useCount(to: number, decimals: number, opts: { from?: number; delay?: number; start?: string } = {}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.textContent = fmt(reduce ? to : (opts.from ?? 0));
    if (reduce) return;
    const o = { v: opts.from ?? 0 };
    const tw = gsap.to(o, { v: to, duration: 2.4, delay: opts.delay ?? 0.4, ease: "power3.out", onUpdate: () => (el.textContent = fmt(o.v)), scrollTrigger: opts.start ? { trigger: el, start: opts.start, once: true } : undefined });
    return () => { tw.kill(); };
  }, [to, decimals, opts.from, opts.delay, opts.start]);
  return ref;
}

const POINTS = "0,40 8,34 14,38 22,22 30,30 38,18 46,26 54,20 62,32 70,16 78,24 86,14 94,22 100,12";

export default function Dashboard({ to = 1.5, from = 0, variant = "hero" }: { to?: number; from?: number; variant?: "hero" | "cta" }) {
  const num = useCount(to, 3, { from, start: variant === "cta" ? "top 80%" : undefined, delay: variant === "cta" ? 0.1 : 0.9 });
  return (
    <div className="dashwrap">
      <div className="dash" data-testid={`dash-${variant}`}>
        <div className="dash-chrome"><i /><i /><i /><span className="sample">SAMPLE DATA</span></div>
        <div className="dash-top">
          <span className="dash-logo"><Mark size={1.5} /></span>
          <span className="tabs"><u>My Wallet</u><em>Overview</em><em>Proposals</em><em>Address book</em><em>Red team</em></span>
          <span className="search">Search account...</span>
          <span className="demo"><b>Demo</b> 5.000 NEAR cap</span>
          <span className="cw">CONNECT WALLET ›</span>
        </div>
        <div className="dash-body">
          <div className="dash-head"><span className="ic" />My Wallet<span className="range">Last 24 hours ⌄</span><span className="range">⤓ Export</span></div>
          <div className="dash-grid">
            <div>
              <small>Held for co-sign</small>
              <p className="bignum"><span ref={num} aria-label={`${to}`} />{" "}<sub>NEAR</sub></p>
              <div className="dash-chart">
                <div className="dash-chart-head"><span><small>Spend chart</small><b>2.246</b></span><span className="rg"><i className="on">All</i><i>1H</i><i>1D</i><i>1W</i><i>1Y</i></span></div>
                <svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden><polyline points={POINTS} fill="none" stroke="#222" strokeWidth=".5" vectorEffect="non-scaling-stroke" /><rect x="52" y="0" width="22" height="50" fill="rgba(255,90,40,.18)" /></svg>
              </div>
            </div>
            <div>
              <div className="dash-stats-tabs"><small>Statistics</small><span><u>24H</u><em>7D</em><em>30D</em></span></div>
              <div className="dash-stats">
                <div><small>Executed</small><b>3.500</b><i className="chip">OWNER</i></div>
                <div><small>Held</small><b>1.500</b><i className="chip">OUTSIDE</i></div>
                <div><small>Daily cap</small><b>5.000</b><i className="chip">ROLLING</i></div>
              </div>
              <div className="dash-alloc"><span><u>Provenance</u><em>Charts</em></span>
                <div className="bars"><div><b>OWNER</b><i style={{ height: "58%" }} /><small>3.500</small></div><div><b>OUTSIDE</b><i style={{ height: "28%" }} className="hot" /><small>1.500</small></div><div><b>CO-SIGNED</b><i style={{ height: "10%" }} /><small>0.400</small></div></div>
              </div>
            </div>
          </div>
          {variant === "cta" && (
            <div className="dash-table">
              <span className="tb"><i className="on">Open proposals</i><i>History</i><i>Policy</i></span>
              <table><tbody><tr><td>attacker.testnet</td><td>1.500 NEAR</td><td className="hot">HELD</td></tr><tr><td>acme.testnet</td><td>0.400 NEAR</td><td>EXECUTED</td></tr></tbody></table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
