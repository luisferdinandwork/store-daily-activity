// app/api/upload/issue/route.ts
// Saves issue-report images to /public/issue-report/
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
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

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

/** Extracts a safe file extension from a MIME type or original filename. */
function safeExt(file: File): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/gif':  'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  const fromMime = mimeMap[file.type];
  if (fromMime) return fromMime;

  // Fallback: pull extension from original filename
  const parts = file.name.split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1].toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }
  return 'jpg';
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

    // Validate every file is an image
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: `${file.name} is not an image` },
          { status: 415 },
        );
      }
    }

    const uploadDir = path.join(process.cwd(), 'public', 'issue-report');
    await mkdir(uploadDir, { recursive: true });

    const titleSlug = slugify(title ?? 'issue');
    const storeSlug = slugify(storeName ?? 'store');
    const date      = todayStr();

    // ── Write all files in parallel ───────────────────────────────────────────
    const urls = await Promise.all(
      files.map(async (file, index) => {
        const ext      = safeExt(file);
        // Append 1-based index so concurrent files never collide on the same name
        const filename = `${titleSlug}_${storeSlug}_${date}_${index + 1}.${ext}`;

        const finalName = await resolveFilename(uploadDir, filename);
        const buffer    = Buffer.from(await file.arrayBuffer());
        await writeFile(path.join(uploadDir, finalName), buffer);

        return `/issue-report/${finalName}`;
      }),
    );

    return NextResponse.json({ urls }, { status: 201 });

  } catch (err) {
    console.error('[POST /api/upload/issue]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// ─── Resolve filename collisions ──────────────────────────────────────────────
// If <title>_<store>_<date>.jpg already exists, append _2, _3, etc.

async function resolveFilename(dir: string, filename: string): Promise<string> {
  const { access } = await import('fs/promises');

  const dot  = filename.lastIndexOf('.');
  const base = dot !== -1 ? filename.slice(0, dot) : filename;
  const ext  = dot !== -1 ? filename.slice(dot)    : '';

  let candidate = filename;
  let counter   = 2;

  while (true) {
    try {
      await access(path.join(dir, candidate));
      // File exists — try next suffix
      candidate = `${base}_${counter}${ext}`;
      counter++;
    } catch {
      // File does not exist — this name is free
      return candidate;
    }
  }
}