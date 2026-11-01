"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

export const SECTIONS = [
  { id: "intro", label: "INTRO" },
  { id: "demo", label: "LIVE DEMO" },
  { id: "workflow", label: "WORKFLOW" },
  { id: "features", label: "FEATURES" },
  { id: "interface", label: "INTERFACE" },
  { id: "privacy", label: "PRIVACY" },
  { id: "benchmark", label: "BENCHMARK" },
  { id: "ecosystem", label: "ECOSYSTEM" },
  { id: "faq", label: "FAQ" },
  { id: "install", label: "START" },
];

const NAV = [
  { label: "HOW IT WORKS", id: "workflow" },
  { label: "FEATURES", id: "features" },
  { label: "PRIVACY", id: "privacy" },
  { label: "BENCHMARK", id: "benchmark" },
];
const GLYPHS = "#*+=-%";

let lenisRef: Lenis | null = null;
const go = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenisRef) lenisRef.scrollTo(el, { offset: -53, duration: 1.4 });
  else el.scrollIntoView({ behavior: "smooth" });
};

function scramble(el: HTMLElement) {
  const full = el.dataset.text!;
  const o = { p: 0 };
  gsap.set(el, { opacity: 1 });
  gsap.to(o, {
    p: 1, duration: Math.min(1.1, 0.4 + full.length * 0.03), ease: "power2.out",
    onUpdate() {
      const k = Math.floor(o.p * full.length);
      let s = full.slice(0, k);
      for (let i = k; i < full.length; i++) s += full[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = s;
    },
    onComplete() { el.textContent = full; },
  });
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(0);
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lenis: Lenis | null = null;
    let tick: ((t: number) => void) | null = null;
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 });
      lenisRef = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      tick = (t) => lenis!.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }
    const ctx = gsap.context(() => {
      SECTIONS.forEach((s, i) => {
        ScrollTrigger.create({
          trigger: `#${s.id}`, start: "top 55%", end: "bottom 55%",
          onToggle: (self) => self.isActive && setActive(i),
        });
      });
      if (reduce) return;
      // headline scramble-in
      gsap.utils.toArray<HTMLElement>("[data-scramble]").forEach((el) => {
        el.dataset.text = el.textContent || "";
        gsap.set(el, { opacity: 0 });
        ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => scramble(el) });
      });
      // fade-up groups
      gsap.utils.toArray<HTMLElement>("[data-fade]").forEach((el) => {
        gsap.from(el, { y: 28, autoAlpha: 0, duration: 0.95, ease: "power4.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-stagger]").forEach((g) => {
        gsap.from(g.children, { y: 36, autoAlpha: 0, duration: 0.95, ease: "power4.out", stagger: 0.075, scrollTrigger: { trigger: g, start: "top 85%", once: true } });
      });
      // frame lines draw in
      gsap.utils.toArray<HTMLElement>("[data-line]").forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: "left", duration: 1.2, ease: "power3.inOut", scrollTrigger: { trigger: el, start: "top 92%", once: true } });
      });
      // hero intro
      const tl = gsap.timeline({ defaults: { ease: "power4.out" }, delay: 0.1 });
      tl.from(".nav", { yPercent: -100, duration: 0.8 })
        .from(".hero-meta", { autoAlpha: 0, duration: 0.8 }, "-=0.4")
        .from(".hero-cta > *", { y: 30, autoAlpha: 0, duration: 0.9, stagger: 0.1 }, "-=0.3")
        .from(".rail", { xPercent: 100, duration: 0.9 }, 0.2);
      // pixel "00" counter
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
        const to = Number(el.dataset.count);
        const o = { v: 0 };
        gsap.to(o, { v: to, duration: 1.4, ease: "power3.out", onUpdate: () => (el.textContent = String(Math.round(o.v)).padStart(2, "0")), scrollTrigger: { trigger: el, start: "top 85%", once: true } });
      });
      // glitch words
      const glitch = Array.from(document.querySelectorAll<HTMLElement>(".glitch"));
      let last = 0;
      const gt = (time: number) => {
        if (time - last < 0.11) return;
        last = time;
        glitch.forEach((g) => g.querySelectorAll<HTMLElement>("i").forEach((c) => {
          const r = Math.random();
          c.style.transform = r < 0.35 ? `translateY(${((Math.random() * 8 - 4) | 0)}px) skewX(${(Math.random() * 26 - 13) | 0}deg)` : "skewX(-8deg)";
        }));
      };
      gsap.ticker.add(gt);
      return () => gsap.ticker.remove(gt);
    });
    const onLoad = () => ScrollTrigger.refresh();
    window.addEventListener("load", onLoad);
    return () => {
      window.removeEventListener("load", onLoad);
      ctx.revert();
      if (tick) gsap.ticker.remove(tick);
      lenis?.destroy();
      lenisRef = null;
    };
  }, []);

  const cur = SECTIONS[active].id;
  const navOn = (id: string) => NAV.find((n) => n.id === cur)?.id === id;

  return (
    <>
      <header className="nav">
        <a className="brand" href="#intro" onClick={(e) => { e.preventDefault(); go("intro"); }}>
          <span className="logo" aria-hidden>▣</span> taint.testnet <span className="ver">V0.1.0</span>
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={navOn(n.id) ? "on" : ""} onClick={(e) => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
          <a href="#faq" onClick={(e) => { e.preventDefault(); go("faq"); }}>FAQ</a>
          <a className="install" href="#install" onClick={(e) => { e.preventDefault(); go("install"); }}>READ THE REPO <span>↗</span></a>
        </nav>
      </header>

      <aside className="rail" ref={railRef} aria-label="Sections">
        <button className="rail-arrow" aria-label="Previous section" onClick={() => go(SECTIONS[Math.max(0, active - 1)].id)}>↑</button>
        <ol>
          {SECTIONS.map((s, i) => (
            <li key={s.id} className={i === active ? "on" : ""}>
              <span className="rail-label">{s.label}</span>
              <button onClick={() => go(s.id)}>{String(i + 1).padStart(2, "0")}</button>
            </li>
          ))}
        </ol>
        <button className="rail-arrow" aria-label="Next section" onClick={() => go(SECTIONS[Math.min(SECTIONS.length - 1, active + 1)].id)}>↓</button>
      </aside>

      <main>{children}</main>
    </>
  );
}

export { go };
