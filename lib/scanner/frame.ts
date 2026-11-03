// lib/scanner/frame.ts
// Browser-only glue between a <video>/<canvas> and the pure scanner engine.

import type { Quad, Raster } from './types';
import { boundsOf } from './geometry';

/** A reusable off-screen canvas so the live loop doesn't allocate every tick. */
export function createScratch(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/**
 * Copies `src` (or just `region`, as fractions of it) into a small raster whose
 * long edge is at most `maxEdge`.
 */
export function sampleRaster(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxEdge: number,
  scratch: HTMLCanvasElement,
  region?: { x0: number; y0: number; x1: number; y1: number },
): Raster | null {
  const sx = region ? Math.max(0, region.x0) * srcW : 0;
  const sy = region ? Math.max(0, region.y0) * srcH : 0;
  const sw = region ? (Math.min(1, region.x1) - Math.max(0, region.x0)) * srcW : srcW;
  const sh = region ? (Math.min(1, region.y1) - Math.max(0, region.y0)) * srcH : srcH;
  if (sw < 8 || sh < 8) return null;

  const k = Math.min(1, maxEdge / Math.max(sw, sh));
  const dw = Math.max(8, Math.round(sw * k));
  const dh = Math.max(8, Math.round(sh * k));
  if (scratch.width !== dw) scratch.width = dw;
  if (scratch.height !== dh) scratch.height = dh;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const img = ctx.getImageData(0, 0, dw, dh);
  return { data: img.data, width: dw, height: dh };
}

/** The part of a frame worth measuring focus on: the tracked sheet, else the middle. */
export function focusRegion(quad: Quad | null): { x0: number; y0: number; x1: number; y1: number } {
  if (!quad) return { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
  const b = boundsOf(quad);
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
}

export function rasterToCanvas(r: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return canvas;
}

export function canvasToRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: img.data, width: img.width, height: img.height };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
}

const QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];

/**
 * JPEG under `maxBytes`: steps the quality down, and only if that isn't enough
 * shrinks the picture a little and tries again.
 */
export async function canvasToJpegFile(
  source: HTMLCanvasElement, baseName = 'scan', maxBytes = 900_000,
): Promise<File | null> {
  let canvas = source;
  for (let shrink = 0; shrink < 4; shrink++) {
    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, q);
      if (!blob) return null;
      if (blob.size <= maxBytes || (shrink === 3 && q === QUALITIES[QUALITIES.length - 1])) {
        return new File([blob], `${baseName}-${Date.now()}.jpg`, { type: 'image/jpeg' });
      }
    }
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(canvas.width * 0.85);
    smaller.height = Math.round(canvas.height * 0.85);
    const ctx = smaller.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
  }
  return null;
}
