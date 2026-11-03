// lib/scanner/geometry.ts
// Small planar-geometry helpers used by detection, tracking and warping.

import type { Point, Quad } from './types';

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2; // signed
}

/** Convex hull (Andrew's monotone chain). Returns counter-clockwise points (math axes). */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function lineIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1.x * p2.y - p1.y * p2.x;
  const b = p3.x * p4.y - p3.y * p4.x;
  return {
    x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d,
    y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d,
  };
}

/**
 * Reduces a convex polygon to its tightest enclosing quadrilateral: repeatedly
 * drops the edge whose removal (extending its two neighbours until they meet)
 * adds the least area. A rounded / slightly bent sheet therefore keeps all of
 * its paper inside the quad instead of losing a corner.
 */
export function hullToQuadPoints(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  let pts = hull.slice();
  if (polygonArea(pts) < 0) pts.reverse(); // interior is to the left of every edge

  while (pts.length > 4) {
    const n = pts.length;
    let bestI = -1;
    let bestCost = Infinity;
    let bestP: Point | null = null;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const d = pts[(i + 2) % n];
      const p = lineIntersect(a, b, d, c);
      if (!p) continue;
      const side = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
      if (side >= 0) continue; // neighbours diverge: no outer corner for this edge
      const cost = Math.abs(side) / 2;
      if (cost < bestCost) { bestCost = cost; bestI = i; bestP = p; }
    }
    if (bestI < 0 || !bestP) return null;
    const next: Point[] = [];
    for (let k = 0; k < n; k++) {
      if (k === bestI) next.push(bestP);
      else if (k === (bestI + 1) % n) continue;
      else next.push(pts[k]);
    }
    pts = next;
  }
  return pts;
}

/** Orders four points as TL, TR, BR, BL (image axes: y grows downward). */
export function orderQuad(pts: Point[]): Quad {
  const byY = pts.slice().sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

export function quadArea(q: Quad): number {
  return Math.abs(polygonArea(q));
}

export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Interior angle at vertex i, in degrees. */
export function cornerAngle(q: Quad, i: number): number {
  const p = q[(i + 3) % 4];
  const c = q[i];
  const n = q[(i + 1) % 4];
  const v1 = { x: p.x - c.x, y: p.y - c.y };
  const v2 = { x: n.x - c.x, y: n.y - c.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map(p => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/** Grows (factor > 1) or shrinks a quad about its centre. */
export function expandQuad(q: Quad, factor: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map(p => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor })) as Quad;
}

export function clampQuad(q: Quad, w: number, h: number): Quad {
  return q.map(p => ({
    x: Math.min(w, Math.max(0, p.x)),
    y: Math.min(h, Math.max(0, p.y)),
  })) as Quad;
}

/** Largest corner displacement between two quads (same coordinate space). */
export function maxCornerShift(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y));
  return m;
}

export function boundsOf(q: Quad): { x0: number; y0: number; x1: number; y1: number } {
  const xs = q.map(p => p.x);
  const ys = q.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function fullFrameQuad(w: number, h: number, inset = 0): Quad {
  const ix = w * inset;
  const iy = h * inset;
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ];
}
