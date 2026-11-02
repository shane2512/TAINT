"use client";
import { useEffect } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { Icon, Mark } from "./ui";

let lenisRef: Lenis | null = null;
export const go = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenisRef) lenisRef.scrollTo(el, { offset: -20, duration: 1.5 });
  else el.scrollIntoView({ behavior: "smooth" });
};

export const REPO = "https://github.com/shane2512/TAINT";

export function Nav() {
  const to = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); go(id); };
  return (
    <header className="nav" data-testid="nav">
      <Link className="brand" href="/"><Mark size={26} /><span>TAINT</span></Link>
      <nav aria-label="Sections">
        <a href="#how" onClick={to("how")}>How it works</a>
        <a href="#modes" onClick={to("modes")}>Modes</a>
        <a href="#results" onClick={to("results")}>Results</a>
        <a href="#faq" onClick={to("faq")}>FAQ</a>
      </nav>
      <div className="nav-cta">
        <a className="btn ghost" href={REPO} target="_blank" rel="noreferrer"><Icon name="github" size={14} /> GitHub</a>
        <Link className="btn solid" href="/demo">Try the demo <Icon name="right" size={12} /></Link>
      </div>
    </header>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lenis: Lenis | null = null;
    let tick: ((t: number) => void) | null = null;
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
      lenisRef = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      tick = (t) => lenis!.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }
    const ctx = gsap.context(() => {
      if (reduce) return;
      // headlines: each line slides up out of its mask
      gsap.utils.toArray<HTMLElement>("[data-lines]").forEach((h) => {
        const lines = h.querySelectorAll(".ln > span");
        gsap.from(lines, { yPercent: 108, duration: 1.1, ease: "power4.out", stagger: 0.11, scrollTrigger: h.closest("[data-hero]") ? undefined : { trigger: h, start: "top 86%", once: true }, delay: h.closest("[data-hero]") ? 0.25 : 0 });
      });
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        const hero = !!el.closest("[data-hero]");
        gsap.from(el, { y: 28, autoAlpha: 0, duration: 1, ease: "power3.out", delay: hero ? 0.35 + Number(el.dataset.reveal || 0) : Number(el.dataset.reveal || 0), scrollTrigger: hero ? undefined : { trigger: el, start: "top 88%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-stagger]").forEach((g) => {
        gsap.from(g.children, { y: 44, autoAlpha: 0, duration: 1.05, ease: "power3.out", stagger: 0.09, scrollTrigger: { trigger: g, start: "top 84%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        gsap.fromTo(el, { y: Number(el.dataset.parallax) }, { y: -Number(el.dataset.parallax), ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.9 } });
      });
      gsap.utils.toArray<HTMLElement>("[data-draw]").forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: "left", duration: 1.4, ease: "power3.inOut", scrollTrigger: { trigger: el, start: "top 92%", once: true } });
      });
      // the product window rises into place and its glow comes up behind it
      gsap.from(".hero-dash", { y: 90, autoAlpha: 0, duration: 1.5, ease: "power4.out", delay: 0.55 });
      gsap.from(".hero-glow", { autoAlpha: 0, duration: 2.2, ease: "power2.out" });
      gsap.from(".nav", { yPercent: -100, autoAlpha: 0, duration: 0.9, ease: "power4.out" });
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
  return (
    <>
      <Nav />
      <main className="landing">{children}</main>
    </>
  );
}
