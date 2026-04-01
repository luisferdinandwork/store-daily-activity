// lib/storage/images.ts
// ─────────────────────────────────────────────────────────────────────────────
// Local image storage utility.
//
// All uploaded images land under:
//   <project-root>/storage/
//     opening/          ← store_opening_tasks
//     setoran/          ← setoran_tasks
//     receiving/        ← receiving_tasks
//     edc/              ← edc_summary + edc_settlement
//     eod/              ← eod_z_report
//     statement/        ← open_statement
//     grooming/         ← grooming_tasks
//     misc/             ← anything else
//
// Files are named:   <YYYY-MM-DD>_store<storeId>_<userId>_<uuid>.<ext>
// The stored DB value is the relative path from the storage root, e.g.:
//   "opening/2024-03-01_store3_EMP-0001_a1b2c3.jpg"
//
// In production you would swap writeImageFile / readImagePath for an
// S3/GCS call — the rest of the codebase stays the same.
// ─────────────────────────────────────────────────────────────────────────────

import path    from 'path';
import fs      from 'fs';
import { randomUUID } from 'crypto';

export type ImageCategory =
  | 'opening'
  | 'setoran'
  | 'receiving'
  | 'edc'
  | 'eod'
  | 'statement'
  | 'grooming'
  | 'misc';

const STORAGE_ROOT = path.join(process.cwd(), 'storage');

/** Ensure the storage directory tree exists (call once at startup). */
export function ensureStorageDirs(): void {
  const categories: ImageCategory[] = [
    'opening', 'setoran', 'receiving', 'edc', 'eod', 'statement', 'grooming', 'misc',
  ];
  for (const cat of categories) {
    fs.mkdirSync(path.join(STORAGE_ROOT, cat), { recursive: true });
  }
}

/**
 * Persist a single image buffer to disk.
 *
 * @param buffer     Raw binary data (from `file.arrayBuffer()` or multer)
 * @param category   Subfolder
 * @param storeId    For filename namespacing
 * @param userId     For filename namespacing
 * @param extension  File extension without the dot, e.g. "jpg"
 * @returns          Relative path from storage root, e.g. "opening/2024-03-01_store3_EMP-0001_uuid.jpg"
 */
export function writeImageFile(
  buffer:    Buffer,
  category:  ImageCategory,
  storeId:   number,
  userId:    string,
  extension: string,
): string {
  ensureStorageDirs();
  const date     = new Date().toISOString().slice(0, 10);
  const filename = `${date}_store${storeId}_${userId}_${randomUUID()}.${extension}`;
  const relPath  = `${category}/${filename}`;
  const absPath  = path.join(STORAGE_ROOT, relPath);
  fs.writeFileSync(absPath, buffer);
  return relPath;
}

/**
 * Persist multiple images and return an array of relative paths.
 * Suitable for passing directly to `JSON.stringify` before storing in the DB.
 */
export async function writeImageFiles(
  files:    { buffer: Buffer; extension: string }[],
  category: ImageCategory,
  storeId:  number,
  userId:   string,
): Promise<string[]> {
  return files.map(f => writeImageFile(f.buffer, category, storeId, userId, f.extension));
}

/**
 * Return the absolute on-disk path for a relative path stored in the DB.
 */
export function resolveImagePath(relativePath: string): string {
  return path.join(STORAGE_ROOT, relativePath);
}

/**
 * Return a public URL for serving the image via your API route.
 * Example: GET /api/storage/opening/2024-03-01_store3_EMP-0001_uuid.jpg
 */
export function imageUrl(relativePath: string): string {
  return `/api/storage/${relativePath}`;
}

/**
 * Parse the JSON photo array stored in a task column.
 * Returns an empty array if the column is null/undefined/invalid.
 */
export function parsePhotoPaths(json: string | null | undefined): string[] {
  if (!json) return [];
  try { return JSON.parse(json) as string[]; }
  catch { return []; }
}

/**
 * Parse and convert DB photo paths to public URLs in one step.
 */
export function parsePhotoUrls(json: string | null | undefined): string[] {
  return parsePhotoPaths(json).map(imageUrl);
}

/**
 * Delete an image file from disk (e.g. when a task is rejected and resubmitted).
 * Silently ignores missing files.
 */
export function deleteImageFile(relativePath: string): void {
  try { fs.unlinkSync(resolveImagePath(relativePath)); }
  catch { /* file already gone */ }
}