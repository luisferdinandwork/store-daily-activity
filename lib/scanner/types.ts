// lib/scanner/types.ts
// Shared shapes for the document-scanner engine (detect → warp → enhance).
// Everything in lib/scanner/* except frame.ts is pure (no DOM) so it can be
// unit-tested in Node: `npx tsx scripts/test-scanner.ts`.

export interface Point { x: number; y: number }

/** Four corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** RGBA raster, same layout as the browser's ImageData. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ScanFilter = 'document' | 'color' | 'original';

export const SCAN_FILTER_LABEL: Record<ScanFilter, string> = {
  document: 'Dokumen',
  color: 'Warna',
  original: 'Asli',
};
