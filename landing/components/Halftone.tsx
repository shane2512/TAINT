"use client";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

// Halftone art: a painted dusk landscape drawn off-screen, then re-drawn as a grid of dots whose size follows the light.
// Nothing is loaded: the "painting" is generated here, so the dots are our own.

type Scene = "dusk" | "waves" | "orb";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function ridge(w: number, base: number, amp: number, seed: number, rough: number): number[] {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  return Array.from({ length: w }, (_, x) => base + amp * (Math.sin(x * 0.011 * rough + ph[0]) * 0.55 + Math.sin(x * 0.027 * rough + ph[1]) * 0.3 + Math.sin(x * 0.061 * rough + ph[2]) * 0.15));
}

/** Paints the scene at low resolution; returns luminance 0..1 (and warmth) per pixel. */
export function paint(scene: Scene, w: number, h: number, seed: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  if (scene === "dusk") {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, "#1a0f14");
    sky.addColorStop(0.45, "#7a3b1c");
    sky.addColorStop(0.8, "#f0a23c");
    sky.addColorStop(1, "#ffd27a");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.34, h * 0.5, 2, w * 0.34, h * 0.5, w * 0.34);
    sun.addColorStop(0, "rgba(255,244,200,1)");
    sun.addColorStop(0.35, "rgba(255,190,90,.8)");
    sun.addColorStop(1, "rgba(255,150,40,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    const layers: [number, number, number, number, string][] = [
      [h * 0.62, h * 0.12, 3, 1.0, "#3a1a10"],
      [h * 0.74, h * 0.14, 9, 1.4, "#1d0c08"],
      [h * 0.9, h * 0.1, 17, 0.8, "#0a0504"],
    ];
    for (const [base, amp, sd, rough, col] of layers) {
      const ys = ridge(w, base, amp, sd + seed, rough);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, h);
      ys.forEach((y, x) => g.lineTo(x, y));
      g.lineTo(w, h);
      g.fill();
      // a rim of light along the crest
      g.strokeStyle = "rgba(255,170,70,.55)";
      g.lineWidth = 1.4;
      g.beginPath();
      ys.forEach((y, x) => (x ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  } else if (scene === "waves") {
    g.fillStyle = "#120806";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const ys = ridge(w, h * (0.12 + i * 0.1), h * 0.1, seed + i * 5, 0.8);
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(220,90,30,.9)");
      grad.addColorStop(0.5, "rgba(255,200,90,.95)");
      grad.addColorStop(1, "rgba(200,70,20,.85)");
      g.strokeStyle = grad;
      g.lineWidth = h * 0.055;
      g.beginPath();
      ys.forEach((y, x) => (x ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  } else {
    // orb: a dark sphere with a bright rim, like an eye in the weather
    g.fillStyle = "#2a1208";
    g.fillRect(0, 0, w, h);
    const rim = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, Math.min(w, h) * 0.5);
    rim.addColorStop(0, "#050202");
    rim.addColorStop(0.5, "#1a0a05");
    rim.addColorStop(0.78, "#ffb347");
    rim.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = rim;
    g.fillRect(0, 0, w, h);
  }
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    out[i * 2] = (0.3 * r + 0.59 * gg + 0.11 * b) / 255; // light
    out[i * 2 + 1] = Math.min(1, Math.max(0, (r - b) / 255)); // warmth
  }
  return out;
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const DEEP = [150, 38, 14], MID = [226, 104, 22], HI = [255, 214, 96];
const colorOf = (l: number) => (l < 0.5 ? mix(DEEP, MID, l / 0.5) : mix(MID, HI, (l - 0.5) / 0.5));

export function Halftone({ scene = "dusk", cell = 14, seed = 3, wave = 0.14, className, rise = false }: { scene?: Scene; cell?: number; seed?: number; wave?: number; className?: string; rise?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let w = 0, h = 0, cols = 0, rows = 0, field: Float32Array = new Float32Array(0), visible = false, last = 0;
    const state = { grow: rise ? 0 : 1 };
    const build = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      cv.width = w;
      cv.height = h;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      field = paint(scene, cols * 2, rows * 2, seed);
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: "120px" });
    io.observe(cv);
    let tw: gsap.core.Tween | undefined;
    if (rise) {
      tw = gsap.to(state, { grow: 1, duration: 2.2, ease: "power3.out", scrollTrigger: { trigger: cv, start: "top 85%", once: true } });
    }
    const tick = (time: number) => {
      if (!visible || time - last < 1 / 30) return;
      last = time;
      ctx.clearRect(0, 0, w, h);
      const fw = cols * 2;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = ((j * 2) * fw + i * 2) * 2;
          const light = field[k];
          const dark = 1 - Math.min(1, light * 1.6);
          if (light < 0.06) continue;
          // the crest of the land comes up first when rising
          const reveal = Math.min(1, Math.max(0, state.grow * 2.2 - (1 - j / rows) * 1.2));
          const ripple = 1 + wave * Math.sin(time * 0.9 + i * 0.35 + j * 0.28);
          const rad = cell * 0.5 * Math.pow(light, 0.85) * ripple * reveal * (1 - dark * 0.12);
          if (rad < 0.35) continue;
          const [r, g, b] = colorOf(Math.min(1, light * 1.25));
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.arc(i * cell + cell / 2, j * cell + cell / 2, rad, 0, 6.2832);
          ctx.fill();
        }
      }
    };
    gsap.ticker.add(tick);
    return () => { gsap.ticker.remove(tick); tw?.kill(); ro.disconnect(); io.disconnect(); };
  }, [scene, cell, seed, wave, rise]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** A small curling shape in halftone, for the grid cells: a tendril of ink. */
export function Tendril({ size = 110, seed = 1, className }: { size?: number; seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d")!;
    const r = rng(seed * 97);
    const turns = 1.6 + r() * 1.2, dir = r() < 0.5 ? 1 : -1, rot = r() * 6.28;
    const cell = 6;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const dx = (x + cell / 2 - size / 2) / (size / 2), dy = (y + cell / 2 - size / 2) / (size / 2);
        const rad = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) * dir + rot;
        // an arm of a spiral: bright where the angle and radius line up
        const arm = Math.cos(ang * 1 - rad * turns * 3.1);
        const body = Math.max(0, arm) * Math.max(0, 1 - rad * 1.05) * (0.35 + rad * 0.8);
        if (body < 0.08) continue;
        const [rr, gg, bb] = colorOf(Math.min(1, 0.25 + body * 0.9));
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.46 * Math.min(1, body * 1.4), 0, 6.2832);
        ctx.fill();
      }
    }
  }, [size, seed]);
  return <canvas ref={ref} className={className} width={size} height={size} aria-hidden="true" />;
}
