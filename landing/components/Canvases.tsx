"use client";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Clock, GlyphOpts, drawFlow, drawGlyphs } from "./ascii";

// Runs `draw` at ~30fps while the canvas is on screen.
function useLoop(ref: React.RefObject<HTMLCanvasElement | null>, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, fps = 30) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    let visible = false, last = 0, w = 0, h = 0;
    const size = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      cv.width = w; cv.height = h;
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: "100px" });
    io.observe(cv);
    const tick = (time: number) => {
      if (!visible || time - last < 1 / fps) return;
      last = time;
      drawRef.current(ctx, w, h);
    };
    gsap.ticker.add(tick);
    return () => { gsap.ticker.remove(tick); ro.disconnect(); io.disconnect(); };
  }, [ref, fps]);
}

export function GlyphCanvas({ clock, opts, className, follow }: { clock: Clock; opts: Omit<GlyphOpts, "mouse">; className?: string; follow?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0, y: 0, on: false });
  const o = useRef(opts); o.current = opts;
  useEffect(() => {
    if (!follow) return;
    const cv = ref.current!;
    const move = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, on: e.clientY > r.top - 40 && e.clientY < r.bottom + 40 };
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [follow]);
  useLoop(ref, (ctx, w, h) => {
    if (!clock.paused) clock.t += 1 / 30;
    drawGlyphs(ctx, w, h, clock.t, { ...o.current, mouse: follow ? mouse.current : undefined });
  });
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

export function FlowCanvas({ clock, className }: { clock: Clock; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  useLoop(ref, (ctx, w, h) => {
    const s = 3; // pixel scale
    const cw = Math.ceil(w / s), ch = Math.ceil(h / s);
    const small = (off.current ??= document.createElement("canvas"));
    if (small.width !== cw || small.height !== ch) { small.width = cw; small.height = ch; }
    drawFlow(small.getContext("2d")!, cw, ch, clock.t, s);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cw, ch, 0, 0, w, h);
  });
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
