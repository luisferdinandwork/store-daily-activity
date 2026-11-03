// lib/scanner/warp.ts
// Perspective "flattening": maps the four corners of the sheet onto an upright
// rectangle so a receipt shot at an angle comes out as if laid flat on a scanner.

import type { Point, Quad, Raster } from './types';
import { dist } from './geometry';

/** Solves the 8×8 system for the homography taking `from[i]` → `to[i]`. */
export function solveHomography(from: Point[], to: Point[]): number[] | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[n] / row[i]);
  return [...h, 1];
}

/**
 * Output size that keeps the sheet's own proportions, within the given limits.
 * ~3 MP is plenty for receipt print and keeps the several full-size rasters the
 * review screen holds (flat, enhanced, rotated) comfortable on low-RAM phones.
 */
export function scanOutputSize(
  quad: Quad, maxEdge = 2400, maxPixels = 3_000_000,
): { width: number; height: number } {
  let w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  let h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const k = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / Math.max(1, w * h)));
  w *= k;
  h *= k;
  return { width: Math.max(16, Math.round(w)), height: Math.max(16, Math.round(h)) };
}

/** Samples `src` through the quad into a `width`×`height` upright raster (bilinear). */
export function warpQuad(src: Raster, quad: Quad, width: number, height: number): Raster {
  // Inverse mapping: for each output pixel find where it comes from in the source.
  const dstRect: Point[] = [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
  ];
  const H = solveHomography(dstRect, quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = src;

  if (!H) {
    // Degenerate quad: fall back to a plain resize of its bounding box.
    return { data: out, width, height };
  }

  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const d = H[6] * px + H[7] * py + 1;
      const sx = (H[0] * px + H[1] * py + H[2]) / d - 0.5;
      const sy = (H[3] * px + H[4] * py + H[5]) / d - 0.5;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const xa = x0 < 0 ? 0 : x0 >= sw ? sw - 1 : x0;
      const xb = x0 + 1 < 0 ? 0 : x0 + 1 >= sw ? sw - 1 : x0 + 1;
      const ya = y0 < 0 ? 0 : y0 >= sh ? sh - 1 : y0;
      const yb = y0 + 1 < 0 ? 0 : y0 + 1 >= sh ? sh - 1 : y0 + 1;

      const i00 = (ya * sw + xa) * 4;
      const i10 = (ya * sw + xb) * 4;
      const i01 = (yb * sw + xa) * 4;
      const i11 = (yb * sw + xb) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
        const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** Rotates a raster clockwise by `quarterTurns` × 90°. */
export function rotateRaster(src: Raster, quarterTurns: number): Raster {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return src;
  const { width: w, height: h, data } = src;
  const ow = turns === 2 ? w : h;
  const oh = turns === 2 ? h : w;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (turns === 1) { nx = h - 1 - y; ny = x; }
      else if (turns === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * 4;
      const d = (ny * ow + nx) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: ow, height: oh };
}
