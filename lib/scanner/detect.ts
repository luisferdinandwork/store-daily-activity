// lib/scanner/detect.ts
// ─────────────────────────────────────────────────────────────────────────────
// Finds the document (receipt, slip, Z-Report strip…) in a camera frame.
//
// Three independent candidates are built from a small (≈256–512 px) copy of the
// frame and the best-supported one wins:
//   · bright mask — paper brighter than its surroundings (Otsu)
//   · dark mask   — the opposite (a pale desk under dark paper)
//   · edge mask   — strong gradients, for paper that is close to the table's tone
// Each mask is hole-filled (so printed text doesn't punch holes in the sheet),
// its biggest blobs are reduced to the tightest enclosing quadrilateral, and a
// quad is only accepted when enough of its outline sits on a real image edge.
// That outline check is what rejects "big bright blob" false positives.
// ─────────────────────────────────────────────────────────────────────────────

import type { Point, Quad, Raster } from './types';
import {
  convexHull, cornerAngle, dist, hullToQuadPoints, isConvexQuad, orderQuad, quadArea,
} from './geometry';
import { refineQuad } from './refine';

export interface DetectResult {
  /** Corners as fractions of the frame (0..1), TL TR BR BL. */
  quad: Quad;
  /** 0..1 — outline support × size; higher is more convincing. */
  score: number;
  /** Fraction of the frame the quad covers. */
  areaFrac: number;
}

export interface FrameStats {
  /** Mean luma 0..255. */
  brightness: number;
}

const MIN_AREA_FRAC = 0.1;
const MIN_SUPPORT = 0.7;

export function toGray(r: Raster): Uint8Array {
  const { data, width, height } = r;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return out;
}

export function frameStats(gray: Uint8Array): FrameStats {
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return { brightness: s / Math.max(1, gray.length) };
}

function boxBlur3(src: Uint8Array, w: number, h: number): Uint8Array {
  const tmp = new Uint16Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = src[row + (x > 0 ? x - 1 : 0)];
      const r = src[row + (x < w - 1 ? x + 1 : w - 1)];
      tmp[row + x] = l + src[row + x] + r;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const dn = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      out[y * w + x] = (tmp[up + x] + tmp[y * w + x] + tmp[dn + x]) / 9;
    }
  }
  return out;
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

/** Sobel gradient magnitude. */
function sobel(gray: Uint8Array, w: number, h: number): Uint16Array {
  const mag = new Uint16Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.min(65535, Math.abs(gx) + Math.abs(gy));
    }
  }
  return mag;
}

function percentile(values: Uint16Array, p: number): number {
  const hist = new Uint32Array(2048);
  for (let i = 0; i < values.length; i++) hist[Math.min(2047, values[i])]++;
  const target = values.length * p;
  let acc = 0;
  for (let v = 0; v < 2048; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 2047;
}

function dilate3(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) { v = 1; break; }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function erode3(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] =
        mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w] &&
        mask[i - w - 1] && mask[i - w + 1] && mask[i + w - 1] && mask[i + w + 1] ? 1 : 0;
    }
  }
  return out;
}

/** Erode then dilate: cuts thin bridges that would fuse the sheet to a nearby bright object. */
function open(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let m = mask;
  for (let i = 0; i < iterations; i++) m = erode3(m, w, h);
  for (let i = 0; i < iterations; i++) m = dilate3(m, w, h);
  return m;
}

/** Any 0-region that cannot reach the frame border is a hole (printed text, logos…): fill it. */
function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !outside[i]) mask[i] = 1;
}

interface Blob {
  area: number;
  /** Boundary pixels (those with a 4-neighbour outside the blob). */
  boundary: Point[];
  /** How many of the four frame borders the blob reaches. */
  bordersTouched: number;
}

/** Biggest connected blobs of a mask (4-connectivity), largest first. */
function topBlobs(mask: Uint8Array, w: number, h: number, minArea: number, limit: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found: { start: number; area: number }[] = [];

  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    let area = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    if (area >= minArea) found.push({ start: s, area });
  }

  found.sort((a, b) => b.area - a.area);
  const blobs: Blob[] = [];
  for (const f of found.slice(0, limit)) {
    // Re-walk the blob to collect its boundary + which borders it reaches.
    const visited = new Uint8Array(w * h);
    let sp = 0;
    stack[sp++] = f.start;
    visited[f.start] = 1;
    const boundary: Point[] = [];
    let top = false, bottom = false, left = false, right = false;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      let edge = false;
      if (x > 0) { if (mask[i - 1]) { if (!visited[i - 1]) { visited[i - 1] = 1; stack[sp++] = i - 1; } } else edge = true; } else { edge = true; left = true; }
      if (x < w - 1) { if (mask[i + 1]) { if (!visited[i + 1]) { visited[i + 1] = 1; stack[sp++] = i + 1; } } else edge = true; } else { edge = true; right = true; }
      if (y > 0) { if (mask[i - w]) { if (!visited[i - w]) { visited[i - w] = 1; stack[sp++] = i - w; } } else edge = true; } else { edge = true; top = true; }
      if (y < h - 1) { if (mask[i + w]) { if (!visited[i + w]) { visited[i + w] = 1; stack[sp++] = i + w; } } else edge = true; } else { edge = true; bottom = true; }
      if (edge) boundary.push({ x, y });
    }
    blobs.push({
      area: f.area,
      boundary,
      bordersTouched: Number(top) + Number(bottom) + Number(left) + Number(right),
    });
  }
  return blobs;
}

function plausibleQuad(q: Quad, w: number, h: number): boolean {
  if (!isConvexQuad(q)) return false;
  for (let i = 0; i < 4; i++) {
    const a = cornerAngle(q, i);
    if (a < 50 || a > 130) return false;
  }
  const top = dist(q[0], q[1]);
  const right = dist(q[1], q[2]);
  const bottom = dist(q[2], q[3]);
  const left = dist(q[3], q[0]);
  const minSide = Math.min(top, right, bottom, left);
  if (minSide < 0.1 * Math.min(w, h)) return false;
  const rH = top / bottom;
  const rV = left / right;
  return rH > 0.45 && rH < 2.2 && rV > 0.45 && rV < 2.2;
}

/** Fraction of the quad outline that lies on a real image edge. */
function outlineSupport(mag: Uint16Array, w: number, h: number, q: Quad, thr: number): number {
  let hit = 0;
  let total = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s];
    const b = q[(s + 1) % 4];
    const len = dist(a, b);
    const nx = (b.y - a.y) / (len || 1);
    const ny = -(b.x - a.x) / (len || 1);
    const n = Math.max(8, Math.round(len / 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      total++;
      // Along the frame border the sheet may simply continue past the lens, but a
      // quad that mostly hugs the border proves nothing — count it half.
      if (px < 2.5 || py < 2.5 || px > w - 3.5 || py > h - 3.5) { hit += 0.5; continue; }
      let found = false;
      for (let o = -4; o <= 4 && !found; o++) {
        const x = Math.round(px + nx * o);
        const y = Math.round(py + ny * o);
        if (x >= 0 && x < w && y >= 0 && y < h && mag[y * w + x] >= thr) found = true;
      }
      if (found) hit++;
    }
  }
  return total ? hit / total : 0;
}

function toNormalised(q: Quad, w: number, h: number): Quad {
  return q.map(p => ({ x: p.x / w, y: p.y / h })) as Quad;
}

/**
 * Looks for a document in `frame`. Pass a downscaled copy (long edge ≈ 256 for
 * the live preview, ≈ 512 for the final capture). Returns null when nothing
 * sheet-shaped with a convincing outline is found.
 */
export function detectDocument(frame: Raster): DetectResult | null {
  const { width: w, height: h } = frame;
  if (w < 32 || h < 32) return null;

  const gray = boxBlur3(toGray(frame), w, h);
  const mag = sobel(gray, w, h);
  const p98 = percentile(mag, 0.98);
  const edgeThr = Math.max(48, p98 * 0.3);
  // Outline check: refinement already pinned the sides to real steps, so this
  // only needs a floor above sensor noise — not a fraction of the print's contrast.
  const supportThr = Math.max(30, p98 * 0.06);
  const frameArea = w * h;
  const minArea = frameArea * MIN_AREA_FRAC;

  const masks: { mask: Uint8Array; solid: boolean }[] = [];

  const t = otsu(gray);
  let bright: Uint8Array = new Uint8Array(w * h);
  let dark: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > t) bright[i] = 1; else dark[i] = 1;
  }
  // Fill the print first, then cut thin bridges to neighbouring objects.
  fillHoles(bright, w, h);
  fillHoles(dark, w, h);
  const openBy = Math.max(1, Math.round(Math.min(w, h) / 60));
  bright = open(bright, w, h, openBy);
  dark = open(dark, w, h, openBy);
  masks.push({ mask: bright, solid: true }, { mask: dark, solid: true });

  const edges = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) if (mag[i] >= edgeThr) edges[i] = 1;
  const grown = dilate3(dilate3(edges, w, h), w, h);
  fillHoles(grown, w, h);
  masks.push({ mask: grown, solid: false });

  let best: DetectResult | null = null;

  for (const { mask, solid } of masks) {
    for (const blob of topBlobs(mask, w, h, minArea, 3)) {
      // A sheet fully in view touches at most one border; wrapping 3+ means this is the table / wall.
      if (blob.bordersTouched >= 3) continue;
      const hull = convexHull(blob.boundary);
      const raw = hullToQuadPoints(hull);
      if (!raw) continue;
      const rough = orderQuad(raw);
      if (!plausibleQuad(rough, w, h)) continue;

      // A solid mask should actually fill its quad; an edge blob need not.
      const fill = solid ? blob.area / quadArea(rough) : 1;
      if (fill < 0.8) continue;

      // Snap the rough outline onto the real paper edge, then judge *that*.
      const quad = refineQuad(gray, w, h, rough);
      if (!plausibleQuad(quad, w, h)) continue;
      const areaFrac = quadArea(quad) / frameArea;
      if (areaFrac < MIN_AREA_FRAC) continue;

      const support = outlineSupport(mag, w, h, quad, supportThr);
      if (support < MIN_SUPPORT) continue;

      const score = support * Math.sqrt(areaFrac) * Math.min(1, fill / 0.9);
      if (!best || score > best.score) {
        best = { quad: toNormalised(quad, w, h), score, areaFrac };
      }
    }
  }
  return best;
}

/**
 * Focus measure: variance of the Laplacian. Only comparable between frames of
 * the same scene sampled at the same size — the scanner uses it to wait for the
 * autofocus to settle and to pick the sharpest frame of a short burst.
 */
export function sharpness(frame: Raster): number {
  const { width: w, height: h } = frame;
  if (w < 3 || h < 3) return 0;
  const g = toGray(frame);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
