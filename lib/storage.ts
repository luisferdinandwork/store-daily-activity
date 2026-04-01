/**
 * lib/storage.ts
 *
 * Local filesystem image storage utility.
 *
 * Directory structure:
 *   /storage/
 *     store-opening/
 *     setoran/
 *     cek-bin/
 *     product-check/
 *     receiving/
 *     briefing/           (future — no photos yet)
 *     edc-summary/
 *     edc-settlement/
 *     eod-z-report/
 *     open-statement/
 *     grooming/
 *
 * File naming convention:
 *   Shared tasks  : <YYYY-MM-DD>_<storeId>_<suffix>.<ext>
 *   Personal tasks: <YYYY-MM-DD>_<userId>_<suffix>.<ext>
 *
 * Usage:
 *   import { saveTaskImage, getImageUrl } from '@/lib/storage';
 *
 *   const path = await saveTaskImage({
 *     category: 'setoran',
 *     ownerId:  storeId,
 *     date:     new Date(),
 *     suffix:   'cash',
 *     file,
 *   });
 */

import fs   from 'fs/promises';
import path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Root storage directory — override with STORAGE_DIR env var. */
const STORAGE_ROOT = process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage');

/** Max file size accepted (10 MB). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types for task images. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ─── Category directories ─────────────────────────────────────────────────────

export type StorageCategory =
  | 'store-opening'
  | 'setoran'
  | 'cek-bin'
  | 'product-check'
  | 'receiving'
  | 'edc-summary'
  | 'edc-settlement'
  | 'eod-z-report'
  | 'open-statement'
  | 'grooming';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SaveImageOptions {
  /** Task category — maps directly to the sub-directory name. */
  category: StorageCategory;
  /** Store ID (shared tasks) or User ID (personal tasks). */
  ownerId:  string;
  /** Date of the task — used in the filename prefix. */
  date:     Date;
  /** Short suffix that describes what the photo shows, e.g. "cash", "front". */
  suffix:   string;
  /** Raw file buffer (from a multipart/form-data upload). */
  buffer:   Buffer;
  /** MIME type of the uploaded file. */
  mimeType: string;
}

export interface SaveImageResult {
  /** Absolute path on disk, e.g. /storage/setoran/2026-04-01_abc123_cash.jpg */
  absolutePath: string;
  /** Relative path stored in the DB, e.g. /storage/setoran/2026-04-01_abc123_cash.jpg */
  storagePath:  string;
  /** Public URL served by Next.js, e.g. /api/storage/setoran/2026-04-01_abc123_cash.jpg */
  publicUrl:    string;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Saves an uploaded image buffer to the appropriate category directory.
 * Creates the directory if it does not yet exist.
 *
 * @throws {Error} if the file exceeds MAX_FILE_BYTES or has a disallowed MIME type.
 */
export async function saveTaskImage(opts: SaveImageOptions): Promise<SaveImageResult> {
  const { category, ownerId, date, suffix, buffer, mimeType } = opts;

  // Validate
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: jpeg, png, webp.`);
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File too large (${buffer.byteLength} bytes). Max: ${MAX_FILE_BYTES} bytes.`);
  }

  const ext      = extensionFor(mimeType);
  const dateStr  = formatDate(date);
  const filename = sanitize(`${dateStr}_${ownerId}_${suffix}`) + ext;

  const dir          = path.join(STORAGE_ROOT, category);
  const absolutePath = path.join(dir, filename);
  const storagePath  = `/storage/${category}/${filename}`;
  const publicUrl    = `/api/storage/${category}/${filename}`;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return { absolutePath, storagePath, publicUrl };
}

/**
 * Reads an image from disk by its storagePath.
 * Returns null if the file does not exist.
 */
export async function readTaskImage(storagePath: string): Promise<Buffer | null> {
  const absolutePath = path.join(STORAGE_ROOT, storagePath.replace(/^\/storage\//, ''));
  try {
    return await fs.readFile(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Deletes an image from disk by its storagePath.
 * Silently ignores missing files.
 */
export async function deleteTaskImage(storagePath: string): Promise<void> {
  const absolutePath = path.join(STORAGE_ROOT, storagePath.replace(/^\/storage\//, ''));
  try {
    await fs.unlink(absolutePath);
  } catch {
    // File not found — no action needed
  }
}

/**
 * Returns the public URL for a storagePath.
 * Useful when you have a path stored in the DB and need the URL for the frontend.
 */
export function getImageUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  return storagePath.replace(/^\/storage\//, '/api/storage/');
}

/**
 * Ensures all category directories exist (call once at app startup).
 */
export async function ensureStorageDirs(): Promise<void> {
  const categories: StorageCategory[] = [
    'store-opening',
    'setoran',
    'cek-bin',
    'product-check',
    'receiving',
    'edc-summary',
    'edc-settlement',
    'eod-z-report',
    'open-statement',
    'grooming',
  ];

  await Promise.all(
    categories.map((c) => fs.mkdir(path.join(STORAGE_ROOT, c), { recursive: true })),
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return '.jpg';
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    default:           return '.jpg';
  }
}

/** Format a Date as YYYY-MM-DD */
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Strip characters unsafe for filenames */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-]/g, '-');
}