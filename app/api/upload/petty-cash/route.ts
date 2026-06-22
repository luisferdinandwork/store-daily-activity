// app/api/upload/petty-cash/route.ts
//
// Saves petty cash receipt images to /public/petty-cash/
// Filename format: <store-slug>_<YYYY-MM-DD>_<n>.<ext>
//
// Expects multipart/form-data with:
//   file      — a single image File
//   storeName — store name (used in filename)
//
// Returns: { url: string; key: string }
//   url  → public path served by Next.js static files
//   key  → same as url; used by the archive job to locate + delete the file

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// ─── Helpers (identical pattern to /api/upload/issue) ────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  const parts = file.name.split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1].toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }
  return 'jpg';
}

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
      candidate = `${base}_${counter}${ext}`;
      counter++;
    } catch {
      return candidate;
    }
  }
}

// ─── POST /api/upload/petty-cash ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const form      = await req.formData();
    const file      = form.get('file') as File | null;
    const storeName = form.get('storeName') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted.' }, { status: 415 });
    }
    // Max 5 MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 5 MB.' }, { status: 413 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'petty-cash');
    await mkdir(uploadDir, { recursive: true });

    const storeSlug = slugify(storeName ?? 'store');
    const date      = todayStr();
    const ext       = safeExt(file);
    const filename  = `${storeSlug}_${date}.${ext}`;
    const finalName = await resolveFilename(uploadDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, finalName), buffer);

    const url = `/petty-cash/${finalName}`;

    return NextResponse.json({ url, key: url }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/upload/petty-cash]', err);
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }
}