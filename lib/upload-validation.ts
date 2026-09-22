// lib/upload-validation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side validation for uploaded files.
//
// Every upload route used to trust `file.type` (a header the CLIENT chooses) and
// some derived the stored extension from the client's filename. A caller could
// therefore put `evil.html` / `x.svg` — or any bytes at all — into the public-read
// bucket. These helpers look at the actual bytes ("magic numbers") and hand back
// the canonical extension + MIME type to store; callers must use THOSE, never
// the client's.
// ─────────────────────────────────────────────────────────────────────────────

export type SniffedImage = { mime: string; ext: string };

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end));
}

/** Identifies an image by its leading bytes; `null` when it isn't a supported image. */
export function sniffImage(buf: Uint8Array): SniffedImage | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (HEIC_BRANDS.has(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (HEIF_BRANDS.has(brand)) return { mime: 'image/heif', ext: 'heif' };
  }
  return null;
}

/** Like sniffImage, but only accepts the listed extensions (e.g. tasks disallow GIF). */
export function sniffImageOf(buf: Uint8Array, allowedExts: readonly string[]): SniffedImage | null {
  const found = sniffImage(buf);
  return found && allowedExts.includes(found.ext) ? found : null;
}

type DocClass = 'pdf' | 'zip' | 'ole';

/** Declared document MIME → the container format its bytes must have. */
const DOCUMENT_CLASS: Record<string, { cls: DocClass; ext: string }> = {
  'application/pdf': { cls: 'pdf', ext: 'pdf' },
  'application/msword': { cls: 'ole', ext: 'doc' },
  'application/vnd.ms-excel': { cls: 'ole', ext: 'xls' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { cls: 'zip', ext: 'docx' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { cls: 'zip', ext: 'xlsx' },
};

function matchesClass(buf: Uint8Array, cls: DocClass): boolean {
  switch (cls) {
    case 'pdf':
      return ascii(buf, 0, 5) === '%PDF-';
    case 'zip': // OOXML (docx/xlsx) are ZIP containers
      return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole': // legacy .doc/.xls (compound file binary)
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
}

/**
 * Validates an image-or-document upload. `declaredMime` only selects WHICH format to
 * expect; the bytes must actually match it. Returns the canonical MIME + extension to store.
 */
export function validateImageOrDocument(
  buf: Uint8Array,
  declaredMime: string,
  opts: { allowHeic?: boolean } = {},
): SniffedImage | null {
  const doc = DOCUMENT_CLASS[declaredMime];
  if (doc) {
    return matchesClass(buf, doc.cls) ? { mime: declaredMime, ext: doc.ext } : null;
  }

  const image = sniffImage(buf);
  if (!image) return null;
  if (!opts.allowHeic && (image.ext === 'heic' || image.ext === 'heif')) return null;
  return image;
}

/** Spreadsheet uploads for the Excel importers (xlsx / xls / csv). */
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

export function validateSpreadsheetUpload(
  file: { name: string; size: number },
  buf: Uint8Array,
): { ok: true } | { ok: false; error: string; status: 400 | 413 } {
  if (file.size > MAX_SPREADSHEET_BYTES || buf.length > MAX_SPREADSHEET_BYTES) {
    return { ok: false, error: 'File is too large (max 10MB).', status: 413 };
  }
  const name = file.name.toLowerCase();
  const isCsv = name.endsWith('.csv');
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xlsm');
  const isXls = name.endsWith('.xls');
  if (!isCsv && !isXlsx && !isXls) {
    return { ok: false, error: 'Only .xlsx, .xls or .csv files are accepted.', status: 400 };
  }
  if (isXlsx && !matchesClass(buf, 'zip')) {
    return { ok: false, error: 'File is not a valid .xlsx workbook.', status: 400 };
  }
  // .xls is deliberately NOT signature-checked: several ERP/HR exports labelled .xls are really
  // HTML or XML SpreadsheetML, which the parser handles. Size + extension still apply.
  return { ok: true };
}
