// scripts/test-scanner.ts
// Regression test for the document-scanner engine (lib/scanner/*) against
// synthetic camera scenes — no camera, DB or browser needed:
//   npx tsx scripts/test-scanner.ts
import { detectDocument, sharpness, toGray } from '../lib/scanner/detect';
import { QuadTracker } from '../lib/scanner/tracker';
import { enhanceRaster } from '../lib/scanner/enhance';
import { scanOutputSize, solveHomography, warpQuad } from '../lib/scanner/warp';
import type { Point, Quad, Raster } from '../lib/scanner/types';

// ── deterministic noise ──────────────────────────────────────────────────────
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};

interface SceneOpts {
  w: number; h: number;
  /** Sheet corners as fractions of the frame (TL TR BR BL). */
  quad: Quad;
  paper: number;      // paper luma
  table: number;      // table luma
  ink?: number;       // print luma
  clutter?: boolean;  // extra bright blob + stripe in the background
  noise?: number;
  shade?: number;     // lighting gradient across the sheet (0..1)
}

function drawScene(o: SceneOpts): Raster {
  const { w, h } = o;
  const data = new Uint8ClampedArray(w * h * 4);
  const px = o.quad.map(p => ({ x: p.x * w, y: p.y * h }));
  const paperRect: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const H = solveHomography(px, paperRect)!; // scene → paper
  const noise = o.noise ?? 4;
  const ink = o.ink ?? o.paper - 140;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = H[6] * x + H[7] * y + 1;
      const u = (H[0] * x + H[1] * y + H[2]) / d;
      const v = (H[3] * x + H[4] * y + H[5]) / d;
      let l: number;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        l = o.paper - (o.shade ?? 0) * 60 * u;
        // printed lines of text
        const row = Math.floor(v * 60);
        if (row % 2 === 0 && row > 3 && row < 56 && u > 0.08 && u < 0.92) {
          const col = Math.floor(u * 70);
          if ((col * 7 + row * 13) % 5 < 3) l = ink;
        }
      } else {
        l = o.table - 12 * (x / w) + 8 * (y / h);
        if (o.clutter) {
          if (Math.hypot(x - w * 0.9, y - h * 0.12) < w * 0.12) l = o.paper + 10; // lamp / mug
          if (y > h * 0.9 && y < h * 0.94) l = o.paper - 20;                       // keyboard edge
        }
      }
      l += (rnd() - 0.5) * 2 * noise;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = l;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function q(...c: number[]): Quad {
  return [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }];
}

function cornerError(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y));
  return m;
}

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

// ── detection ────────────────────────────────────────────────────────────────
const cases: { name: string; opts: SceneOpts; expect: Quad | null }[] = [
  {
    name: 'portrait sheet, dark table',
    opts: { w: 144, h: 256, quad: q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87), paper: 225, table: 70 },
    expect: q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87),
  },
  {
    name: 'landscape frame, tall narrow strip (Z-Report)',
    opts: { w: 256, h: 144, quad: q(0.38, 0.08, 0.6, 0.1, 0.62, 0.93, 0.36, 0.92), paper: 235, table: 90, shade: 0.4 },
    expect: q(0.38, 0.08, 0.6, 0.1, 0.62, 0.93, 0.36, 0.92),
  },
  {
    name: 'rotated ~15° with strong perspective',
    opts: { w: 144, h: 256, quad: q(0.3, 0.1, 0.9, 0.22, 0.8, 0.88, 0.12, 0.74), paper: 220, table: 60 },
    expect: q(0.3, 0.1, 0.9, 0.22, 0.8, 0.88, 0.12, 0.74),
  },
  {
    name: 'white paper on LIGHT table (low contrast)',
    opts: { w: 144, h: 256, quad: q(0.18, 0.12, 0.84, 0.12, 0.84, 0.88, 0.18, 0.88), paper: 232, table: 190 },
    expect: q(0.18, 0.12, 0.84, 0.12, 0.84, 0.88, 0.18, 0.88),
  },
  {
    name: 'dark paper on pale desk',
    opts: { w: 144, h: 256, quad: q(0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8), paper: 60, table: 200, ink: 20 },
    expect: q(0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8),
  },
  {
    name: 'cluttered background (bright mug + keyboard edge)',
    opts: { w: 144, h: 256, quad: q(0.15, 0.2, 0.75, 0.2, 0.75, 0.8, 0.15, 0.8), paper: 225, table: 80, clutter: true },
    expect: q(0.15, 0.2, 0.75, 0.2, 0.75, 0.8, 0.15, 0.8),
  },
  {
    name: 'noisy low-light frame',
    opts: { w: 144, h: 256, quad: q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87), paper: 120, table: 35, noise: 14 },
    expect: q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87),
  },
  {
    name: 'no document (just a table)',
    opts: { w: 144, h: 256, quad: q(0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2), paper: 80, table: 80 },
    expect: null,
  },
];

// The degenerate quad above can't be inverted — build that scene by hand instead.
function emptyScene(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = 80 - 12 * (x / w) + 8 * (y / h) + (rnd() - 0.5) * 8;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = l; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

console.log('detectDocument');
for (const c of cases) {
  const scene = c.expect ? drawScene(c.opts) : emptyScene(c.opts.w, c.opts.h);
  const t0 = performance.now();
  const res = detectDocument(scene);
  const ms = performance.now() - t0;
  if (!c.expect) {
    check(c.name, res === null, res ? `false positive, score ${res.score.toFixed(2)}` : `${ms.toFixed(0)} ms`);
  } else if (!res) {
    check(c.name, false, 'not found');
  } else {
    const err = cornerError(res.quad, c.expect);
    if (process.env.VERBOSE) {
      const fmt = (z: Quad) => z.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' | ');
      console.log(`      got ${fmt(res.quad)}\n      exp ${fmt(c.expect)}`);
    }
    check(c.name, err < 0.035, `max corner error ${(err * 100).toFixed(1)}% · score ${res.score.toFixed(2)} · ${ms.toFixed(0)} ms`);
  }
}

// ── detection at the larger "final capture" size ─────────────────────────────
console.log('detectDocument @512');
{
  const exp = q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87);
  const scene = drawScene({ w: 288, h: 512, quad: exp, paper: 225, table: 70 });
  const t0 = performance.now();
  const res = detectDocument(scene);
  const ms = performance.now() - t0;
  check('portrait sheet @288×512', !!res && cornerError(res.quad, exp) < 0.02,
    res ? `max corner error ${(cornerError(res.quad, exp) * 100).toFixed(1)}% · ${ms.toFixed(0)} ms` : 'not found');
}

// ── tracker ──────────────────────────────────────────────────────────────────
console.log('QuadTracker');
{
  const tr = new QuadTracker();
  const base = q(0.2, 0.15, 0.82, 0.13, 0.85, 0.85, 0.17, 0.87);
  let st = tr.update(base, 0);
  for (let t = 100; t <= 1000; t += 100) {
    const jitter = (rnd() - 0.5) * 0.004;
    st = tr.update(base.map(p => ({ x: p.x + jitter, y: p.y + jitter })) as Quad, t);
  }
  check('still document accumulates stable time', st.stableMs >= 900, `${st.stableMs} ms`);
  const moved = tr.update(q(0.3, 0.2, 0.9, 0.2, 0.9, 0.9, 0.3, 0.9), 1100);
  check('moving the sheet resets the clock', moved.stableMs < 200, `${moved.stableMs} ms`);
  const miss = tr.update(null, 1200);
  check('brief detector dropout keeps the quad but not the streak', !!miss.quad && miss.held && miss.stableMs === 0);
  const gone = tr.update(null, 2500);
  check('long dropout clears the quad', gone.quad === null);
}

// ── sharpness ────────────────────────────────────────────────────────────────
console.log('sharpness');
{
  const sharp = drawScene({ w: 256, h: 256, quad: q(0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95), paper: 225, table: 70 });
  // 3×3 box blur twice = defocus
  const g = toGray(sharp);
  const blurred = new Uint8ClampedArray(sharp.data.length);
  const w = 256;
  const tmp = new Float32Array(g);
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(tmp);
    for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * w + x + dx];
      tmp[y * w + x] = s / 9;
    }
  }
  for (let i = 0; i < tmp.length; i++) { blurred[i * 4] = blurred[i * 4 + 1] = blurred[i * 4 + 2] = tmp[i]; blurred[i * 4 + 3] = 255; }
  const sSharp = sharpness(sharp);
  const sBlur = sharpness({ data: blurred, width: w, height: w });
  check('defocused frame scores clearly lower', sBlur < sSharp * 0.5, `sharp ${sSharp.toFixed(0)} vs blurred ${sBlur.toFixed(0)}`);
}

// ── warp + enhance ───────────────────────────────────────────────────────────
console.log('warp + enhance');
{
  const exp = q(0.3, 0.1, 0.9, 0.22, 0.8, 0.88, 0.12, 0.74);
  const w = 576, h = 1024;
  const scene = drawScene({ w, h, quad: exp, paper: 200, table: 60, shade: 0.7, noise: 3 });
  const px = exp.map(p => ({ x: p.x * w, y: p.y * h })) as Quad;
  const size = scanOutputSize(px);
  const t0 = performance.now();
  const flat = warpQuad(scene, px, size.width, size.height);
  const t1 = performance.now();
  const doc = enhanceRaster(flat, 'document');
  const t2 = performance.now();

  // The sheet is flat now: the border should be (almost) all paper, no table.
  const gFlat = toGray(flat);
  let tableish = 0, edgeN = 0;
  for (let x = 4; x < size.width - 4; x++) {
    for (const y of [4, size.height - 5]) { edgeN++; if (gFlat[y * size.width + x] < 120) tableish++; }
  }
  check('flattened sheet has no table at its border', tableish / edgeN < 0.05, `${(100 * tableish / edgeN).toFixed(1)}% dark border px · warp ${(t1 - t0).toFixed(0)} ms`);

  // Lighting evened out: paper brightness at left vs right edge of the sheet should now match.
  const gDoc = toGray(doc);
  const meanCol = (g: Uint8Array, x0: number, x1: number) => {
    let s = 0, n = 0;
    for (let y = Math.floor(size.height * 0.02); y < size.height * 0.05; y++) for (let x = x0; x < x1; x++) { s += g[y * size.width + x]; n++; }
    return s / n;
  };
  const rawGap = Math.abs(meanCol(gFlat, 10, 40) - meanCol(gFlat, size.width - 40, size.width - 10));
  const docGap = Math.abs(meanCol(gDoc, 10, 40) - meanCol(gDoc, size.width - 40, size.width - 10));
  check('shading is evened out', docGap < rawGap * 0.4 + 6, `left/right gap ${rawGap.toFixed(0)} → ${docGap.toFixed(0)} · enhance ${(t2 - t1).toFixed(0)} ms`);

  // Paper ends up white, print stays dark.
  const sorted = Array.from(gDoc).sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  check('paper is white and print is dark', p90 >= 245 && p10 < 130, `p10 ${p10} · p90 ${p90}`);

  const orig = enhanceRaster(flat, 'original');
  check('"original" leaves pixels untouched', orig.data.every((v, i) => v === flat.data[i]));
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
