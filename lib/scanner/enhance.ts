// lib/scanner/enhance.ts
// ─────────────────────────────────────────────────────────────────────────────
// "Scanner look" for a flattened sheet:
//   1. Estimate the paper's lighting (a heavily smoothed copy that ignores the
//      ink) and divide it out — shadows, a torch hotspot and a dim corner vanish.
//   2. Stretch the levels so paper is white and print is dark — faded thermal
//      receipts (Z-Report, EDC slips) become readable.
// `document` output is grey (smallest files); `color` keeps hue; `original` is
// the plain crop.
// ─────────────────────────────────────────────────────────────────────────────

import type { Raster, ScanFilter } from './types';
import { toGray } from './detect';

/** Paper level after lighting is divided out; anything ≥ this is pushed to pure white. */
const PAPER = 238;

function maxFilter3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const v = src[yy * w + xx];
          if (v > m) m = v;
        }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += src[yy * w + xx];
        }
      }
      out[y * w + x] = s / 9;
    }
  }
  return out;
}

/** Per-pixel paper brightness: block means → drop the ink (max filter) → smooth → bilinear upsample. */
function paperLighting(gray: Uint8Array, w: number, h: number): (x: number, y: number) => number {
  const block = Math.max(2, Math.round(Math.max(w, h) / 160));
  const gw = Math.ceil(w / block);
  const gh = Math.ceil(h / block);
  let cells: Float32Array = new Float32Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let s = 0;
      let n = 0;
      const y1 = Math.min(h, (cy + 1) * block);
      const x1 = Math.min(w, (cx + 1) * block);
      for (let y = cy * block; y < y1; y++) {
        for (let x = cx * block; x < x1; x++) { s += gray[y * w + x]; n++; }
      }
      cells[cy * gw + cx] = s / Math.max(1, n);
    }
  }
  cells = maxFilter3(maxFilter3(cells, gw, gh), gw, gh);
  cells = blur3(blur3(cells, gw, gh), gw, gh);

  return (x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, x / block - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, y / block - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = cells[y0 * gw + x0] * (1 - tx) + cells[y0 * gw + x1] * tx;
    const bot = cells[y1 * gw + x0] * (1 - tx) + cells[y1 * gw + x1] * tx;
    return top * (1 - ty) + bot * ty;
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Returns a new raster; the input is never modified. */
export function enhanceRaster(src: Raster, filter: ScanFilter): Raster {
  const { width: w, height: h } = src;
  const out = new Uint8ClampedArray(src.data);
  if (filter === 'original') return { data: out, width: w, height: h };

  const gray = toGray(src);
  const lighting = paperLighting(gray, w, h);

  // Lighting-corrected luma, kept for the levels pass.
  const norm = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  let medianBg = 0;
  {
    const probe: number[] = [];
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 24))) {
      for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 24))) probe.push(lighting(x, y));
    }
    probe.sort((a, b) => a - b);
    medianBg = probe[probe.length >> 1] || 128;
  }
  const bgFloor = Math.max(24, medianBg * 0.35);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bg = Math.max(bgFloor, lighting(x, y));
      const v = Math.min(255, (gray[i] * 255) / bg);
      norm[i] = v;
      hist[v | 0]++;
    }
  }

  // Black point: where the darkest 0.5 % of pixels sit (never so close to PAPER that noise is amplified).
  let acc = 0;
  let lo = 0;
  const target = w * h * 0.005;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { lo = v; break; } }
  lo = Math.min(lo, PAPER - 40);
  const span = PAPER - lo;
  const blend = filter === 'document' ? 0.7 : 0.4;

  const curve = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    return 255 * (t + (smoothstep(t) - t) * blend);
  };

  if (filter === 'document') {
    for (let i = 0, j = 0; i < norm.length; i++, j += 4) {
      const g = curve(norm[i]);
      out[j] = g; out[j + 1] = g; out[j + 2] = g; out[j + 3] = 255;
    }
  } else {
    // Colour: carry the same per-pixel gain onto each channel, then the same curve.
    const sd = src.data;
    for (let i = 0, j = 0; i < norm.length; i++, j += 4) {
      const gain = gray[i] > 0 ? Math.min(3, norm[i] / gray[i]) : 1;
      out[j] = curve(sd[j] * gain);
      out[j + 1] = curve(sd[j + 1] * gain);
      out[j + 2] = curve(sd[j + 2] * gain);
      out[j + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
