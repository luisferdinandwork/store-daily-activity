// lib/scanner/refine.ts
// Sub-pixel corner refinement. Mask-based detection is only good to a few
// pixels (blur, thresholds, dilation all fatten the blob), so each side of the
// rough quad is snapped onto the strongest brightness step near it, a line is
// fitted through those points (outliers dropped) and neighbouring lines are
// intersected to give the corners.

import type { Point, Quad } from './types';
import { cornerAngle, dist, isConvexQuad } from './geometry';

interface Line { px: number; py: number; dx: number; dy: number } // point + unit direction

function bilinear(gray: Uint8Array, w: number, h: number, x: number, y: number): number {
  const xc = Math.min(w - 1.001, Math.max(0, x));
  const yc = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const fx = xc - x0;
  const fy = yc - y0;
  const i = y0 * w + x0;
  const top = gray[i] + (gray[i + 1] - gray[i]) * fx;
  const bot = gray[i + w] + (gray[i + w + 1] - gray[i + w]) * fx;
  return top + (bot - top) * fy;
}

/** Total-least-squares line through points. */
function fitLine(pts: Point[]): Line | null {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function distToLine(l: Line, p: Point): number {
  return Math.abs((p.x - l.px) * l.dy - (p.y - l.py) * l.dx);
}

function robustLine(pts: Point[]): Line | null {
  let use = pts;
  let line = fitLine(use);
  for (let pass = 0; pass < 3 && line && use.length >= 6; pass++) {
    const d = use.map(p => distToLine(line!, p)).sort((a, b) => a - b);
    const cutoff = Math.max(0.8, d[Math.floor(d.length * 0.5)] * 3);
    const kept = use.filter(p => distToLine(line!, p) <= cutoff);
    if (kept.length === use.length || kept.length < 6) break;
    use = kept;
    line = fitLine(use);
  }
  return line;
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-3) return null; // (nearly) parallel
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}

/**
 * Returns the refined quad, or the input untouched when the image doesn't
 * support a confident refinement (too few edge samples, lines wandering off…).
 * `gray` is the (lightly blurred) luma of the frame the quad is expressed in.
 */
export function refineQuad(gray: Uint8Array, w: number, h: number, quad: Quad): Quad {
  const radius = Math.max(4, Math.round(0.05 * Math.min(w, h)));
  const lines: (Line | null)[] = [];
  const cxQuad = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cyQuad = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;

  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const len = dist(a, b);
    const ux = (b.x - a.x) / (len || 1);
    const uy = (b.y - a.y) / (len || 1);
    const nx = uy, ny = -ux;
    // Orient the normal away from the quad's centre.
    const outward = nx * ((a.x + b.x) / 2 - cxQuad) + ny * ((a.y + b.y) / 2 - cyQuad) >= 0 ? 1 : -1;
    const samples = Math.max(10, Math.round(len / 2));
    const found: Point[] = [];

    for (let k = 0; k <= samples; k++) {
      const t = 0.08 + (0.84 * k) / samples; // keep clear of the corners
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      if (cx < 3 || cy < 3 || cx > w - 4 || cy > h - 4) continue; // sheet runs off-frame here
      // Brightness steps along the normal (o > 0 points away from the sheet's centre).
      const steps: { o: number; d: number }[] = [];
      let maxD = 0;
      let prev = bilinear(gray, w, h, cx + nx * outward * -radius, cy + ny * outward * -radius);
      for (let o = -radius + 0.5; o <= radius; o += 0.5) {
        const v = bilinear(gray, w, h, cx + nx * outward * o, cy + ny * outward * o);
        const d = Math.abs(v - prev);
        steps.push({ o: o - 0.25, d });
        if (d > maxD) maxD = d;
        prev = v;
      }
      // Print just inside the margin is a far stronger step than the paper edge
      // itself, so take the outermost step that is still a real fraction of the
      // strongest one — not the strongest. A step is over 0.5 px: demand a real edge, not texture.
      const need = Math.max(2.5, maxD * 0.3);
      let pick: number | null = null;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].d >= need) { pick = steps[i].o; break; }
      }
      if (pick !== null) found.push({ x: cx + nx * outward * pick, y: cy + ny * outward * pick });
    }
    lines.push(found.length >= Math.max(8, samples * 0.3) ? robustLine(found) : null);
  }

  // Any side we couldn't confirm keeps the rough line through its two corners.
  const full: Line[] = lines.map((l, s) => {
    if (l) return l;
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const len = dist(a, b) || 1;
    return { px: a.x, py: a.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
  });

  const out: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(full[(i + 3) % 4], full[i]);
    if (!p) return quad;
    out.push(p);
  }
  const refined = out as Quad;

  // Refinement must stay a small nudge of a sane quadrilateral.
  const limit = 0.06 * Math.max(w, h);
  for (let i = 0; i < 4; i++) if (dist(refined[i], quad[i]) > limit) return quad;
  if (!isConvexQuad(refined)) return quad;
  for (let i = 0; i < 4; i++) {
    const ang = cornerAngle(refined, i);
    if (ang < 50 || ang > 130) return quad;
  }
  return refined;
}
