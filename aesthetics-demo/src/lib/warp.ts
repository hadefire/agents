import type { Pt, Raster } from "./types";

export type Move = { from: Pt; to: Pt };

function cloneRaster(src: Raster): Raster {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

function bilinear(src: Raster, x: number, y: number): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(y)));
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const at = (px: number, py: number) => {
    const i = (py * src.width + px) * 4;
    return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]] as const;
  };
  const a = at(x0, y0);
  const b = at(x1, y0);
  const c = at(x0, y1);
  const d = at(x1, y1);
  const mix = (i: number) => {
    const top = a[i] * (1 - tx) + b[i] * tx;
    const bot = c[i] * (1 - tx) + d[i] * tx;
    return top * (1 - ty) + bot * ty;
  };
  return [mix(0), mix(1), mix(2), mix(3)];
}

function similarityMap(v: Pt, dest: Pt[], src: Pt[]): Pt {
  const n = dest.length;
  let sumW = 0;
  let dx = 0;
  let dy = 0;
  let sx = 0;
  let sy = 0;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d2 = (dest[i].x - v.x) ** 2 + (dest[i].y - v.y) ** 2;
    if (d2 < 0.25) return src[i];
    w[i] = 1 / d2;
    sumW += w[i];
    dx += w[i] * dest[i].x;
    dy += w[i] * dest[i].y;
    sx += w[i] * src[i].x;
    sy += w[i] * src[i].y;
  }
  dx /= sumW;
  dy /= sumW;
  sx /= sumW;
  sy /= sumW;
  let mu = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const phx = dest[i].x - dx;
    const phy = dest[i].y - dy;
    const qhx = src[i].x - sx;
    const qhy = src[i].y - sy;
    mu += w[i] * (phx * phx + phy * phy);
    a += w[i] * (phx * qhx + phy * qhy);
    b += w[i] * (phx * qhy - phy * qhx);
  }
  if (mu < 1e-6) return { x: v.x - dx + sx, y: v.y - dy + sy };
  const vx = v.x - dx;
  const vy = v.y - dy;
  return { x: (a * vx - b * vy) / mu + sx, y: (b * vx + a * vy) / mu + sy };
}

function insideEllipse(x: number, y: number, c: Pt, rx: number, ry: number): boolean {
  const dx = (x - c.x) / rx;
  const dy = (y - c.y) / ry;
  return dx * dx + dy * dy <= 1;
}

export function warpEllipse(src: Raster, center: Pt, rx: number, ry: number, moves: Move[]): Raster {
  const out = cloneRaster(src);
  if (moves.length === 0 || rx < 2 || ry < 2) return out;
  const dest: Pt[] = [];
  const from: Pt[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    const p = { x: center.x + Math.cos(t) * rx, y: center.y + Math.sin(t) * ry };
    dest.push(p);
    from.push(p);
  }
  for (const move of moves) {
    dest.push(move.to);
    from.push(move.from);
  }
  const x0 = Math.max(0, Math.floor(center.x - rx));
  const x1 = Math.min(src.width - 1, Math.ceil(center.x + rx));
  const y0 = Math.max(0, Math.floor(center.y - ry));
  const y1 = Math.min(src.height - 1, Math.ceil(center.y + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!insideEllipse(x, y, center, rx, ry)) continue;
      const s = similarityMap({ x, y }, dest, from);
      const color = bilinear(src, s.x, s.y);
      const i = (y * src.width + x) * 4;
      out.data[i] = color[0];
      out.data[i + 1] = color[1];
      out.data[i + 2] = color[2];
      out.data[i + 3] = color[3];
    }
  }
  return out;
}

export function shadeSegment(
  raster: Raster,
  a: Pt,
  b: Pt,
  rgba: [number, number, number, number],
  radius: number,
): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(length));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const r = Math.ceil(radius);
    for (let yy = -r; yy <= r; yy++) {
      for (let xx = -r; xx <= r; xx++) {
        if (xx * xx + yy * yy > radius * radius) continue;
        const px = Math.round(x + xx);
        const py = Math.round(y + yy);
        if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) continue;
        const idx = (py * raster.width + px) * 4;
        const fall = 1 - Math.hypot(xx, yy) / (radius + 0.01);
        const alpha = rgba[3] * Math.max(0, fall);
        raster.data[idx] = raster.data[idx] * (1 - alpha) + rgba[0] * alpha;
        raster.data[idx + 1] = raster.data[idx + 1] * (1 - alpha) + rgba[1] * alpha;
        raster.data[idx + 2] = raster.data[idx + 2] * (1 - alpha) + rgba[2] * alpha;
      }
    }
  }
}

export function strokePolyline(
  raster: Raster,
  pts: Pt[],
  rgba: [number, number, number, number],
  radius: number,
): void {
  for (let i = 1; i < pts.length; i++) shadeSegment(raster, pts[i - 1], pts[i], rgba, radius);
}
