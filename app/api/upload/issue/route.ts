// app/api/upload/issue/route.ts
// Saves issue-report images to Biznet NOS (S3) storage under issue-report/.
// Filename format: <sanitized-title>_<sanitized-store>_<YYYY-MM-DD>_<n>.<ext>
//
// Expects multipart/form-data with:
//   files[]   — one or more image Files (up to 5)
//   title     — issue title  (used in filename)
//   storeName — store name   (used in filename)
// Returns: { urls: string[] }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadToStorage, storageObjectExists } from '@/lib/storage';
import { sniffImage } from '@/lib/upload-validation';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // per image

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strips characters that are unsafe in filenames, collapses spaces to hyphens. */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // keep alphanumeric, spaces, hyphens
    .trim()
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .slice(0, 40);                   // cap length
}

/** Returns today as YYYY-MM-DD in local time. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── POST /api/upload/issue ───────────────────────────────────────────────────
// Accepts multiple files in a single request.
// FormData fields:
//   files[]   — one or more image Files (field name must be 'files')
//   title     — issue title  (used in filename)
//   storeName — store name   (used in filename)
// Returns: { urls: string[] }

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const form      = await req.formData();
    const files     = form.getAll('files') as File[];
    const title     = form.get('title')     as string | null;
    const storeName = form.get('storeName') as string | null;

    if (!files.length) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }
    if (files.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 images per issue' }, { status: 400 });
    }

    // Validate EVERYTHING before uploading anything, so a bad 3rd file can't leave the
    // first two orphaned in the bucket. The stored extension / Content-Type come from
    // the file signature — `file.type` and the filename are client-controlled.
    const validated: { buffer: Buffer; ext: string; mime: string }[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is too large (max 10MB).` },
          { status: 413 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffImage(buffer);
      if (!sniffed) {
        return NextResponse.json(
          { error: `${file.name} is not a valid image` },
          { status: 415 },
        );
      }
      validated.push({ buffer, ext: sniffed.ext, mime: sniffed.mime });
    }

    const titleSlug = slugify(title ?? 'issue');
    const storeSlug = slugify(storeName ?? 'store');
    const date      = todayStr();

    // ── Upload all files in parallel ──────────────────────────────────────────
    const urls = await Promise.all(
      validated.map(async ({ buffer, ext, mime }, index) => {
        // Append 1-based index so concurrent files never collide on the same name
        const filename = `${titleSlug}_${storeSlug}_${date}_${index + 1}.${ext}`;

        const finalName = await resolveFilename('issue-report', filename);

        return uploadToStorage(buffer, `issue-report/${finalName}`, mime);
      }),
    );

    return NextResponse.json({ urls }, { status: 201 });

  } catch (err) {
    console.error('[POST /api/upload/issue]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// ─── Resolve filename collisions ──────────────────────────────────────────────
// If <title>_<store>_<date>.jpg already exists in storage, append _2, _3, etc.

async function resolveFilename(prefix: string, filename: string): Promise<string> {
  const dot  = filename.lastIndexOf('.');
  const base = dot !== -1 ? filename.slice(0, dot) : filename;
  const ext  = dot !== -1 ? filename.slice(dot)    : '';

  let candidate = filename;
  let counter   = 2;

  while (await storageObjectExists(`${prefix}/${candidate}`)) {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }

  return candidate;
}