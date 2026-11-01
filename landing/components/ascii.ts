// Shared glyph field. Both the "raw" canvas and the glyph canvases sample this, so they always agree.
export const RAMPS: Record<string, string> = {
  classic: " .:-=+*#%@",
  minimal: " .:+#",
  soft: " .,:;oO",
  dense: " .:-=+*#%@&$",
};

export interface Clock { t: number; paused: boolean }

// v: contour brightness 0..1, r: 1 where the cell is "untrusted" (rendered red)
export function field(x: number, y: number, t: number): { v: number; r: boolean } {
  const a = Math.sin(x * 0.012 + t * 0.5 + Math.sin(y * 0.014 - t * 0.35) * 2.2);
  const b = Math.cos(y * 0.018 + t * 0.42 + Math.cos(x * 0.01 + t * 0.28) * 2.1);
  const f = a * b;
  const g = Math.sin(x * 0.007 - t * 0.3 + Math.cos(y * 0.009 + t * 0.2) * 3);
  const line = Math.pow(1 - Math.abs(Math.sin(f * 4.2)), 3);
  return { v: line, r: g > 0.74 && line > 0.15 };
}

export interface GlyphOpts {
  cell: number;
  ramp: string;
  light?: boolean;
  gate?: boolean; // false: no red tint
  mouse?: { x: number; y: number; on: boolean };
  base?: number; // base alpha multiplier
}

const RED = "217,20,60";

export function drawGlyphs(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, o: GlyphOpts) {
  const { cell, ramp, light, mouse } = o;
  const gate = o.gate !== false;
  const base = o.base ?? 1;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${Math.round(cell * 1.25)}px VT323, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const buckets: number[][] = Array.from({ length: 10 }, () => []);
  const chars: string[] = [];
  const n = ramp.length;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = i * cell + cell / 2, py = j * cell + cell / 2;
      const { v: v0, r } = field(px, py, t);
      let v = v0;
      if (mouse?.on) {
        const d = Math.hypot(px - mouse.x, py - mouse.y);
        if (d < 150) v = Math.min(1, v + (1 - d / 150) * (0.55 + 0.25 * Math.sin(t * 6 - d * 0.05)));
      }
      const idx = Math.floor(v * (n - 1));
      if (idx <= 0) continue;
      const k = chars.length;
      chars.push(ramp[idx]);
      const red = gate && r ? 5 : 0;
      const lvl = Math.min(4, Math.floor(v * 5));
      buckets[red + lvl].push(k, px, py);
    }
  }
  for (let b = 0; b < 10; b++) {
    const list = buckets[b];
    if (!list.length) continue;
    const red = b >= 5;
    const lvl = (b % 5) + 1;
    const a = Math.min(1, (0.12 + lvl * 0.17) * base);
    ctx.fillStyle = red ? `rgba(${RED},${a})` : light ? `rgba(40,40,40,${a * 0.55})` : `rgba(238,238,230,${a})`;
    for (let q = 0; q < list.length; q += 3) ctx.fillText(chars[list[q]], list[q + 1], list[q + 2]);
  }
}

// Raw "source" render: contour lines as pixels (drawn small, scaled up by CSS).
export function drawFlow(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, scale: number, gate = true) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { v, r } = field(x * scale, y * scale, t);
      const o = (y * w + x) * 4;
      const s = Math.min(1, v * 1.4);
      if (gate && r) { d[o] = 217 * s + 30; d[o + 1] = 20 * s; d[o + 2] = 60 * s; }
      else { const c = 235 * s + 14 * (1 - s); d[o] = c; d[o + 1] = c; d[o + 2] = c; }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
