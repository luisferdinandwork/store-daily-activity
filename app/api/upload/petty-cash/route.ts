// app/api/upload/petty-cash/route.ts
//
// Saves petty cash receipt images to Alibaba Cloud OSS under petty-cash/.
// Filename format: <store-slug>_<YYYY-MM-DD>_<n>.<ext>
//
// Expects multipart/form-data with:
//   file      — a single image File
//   storeName — store name (used in filename)
//   kind      — optional label appended to the filename (e.g. "cash",
//               "drawer", "signature") to distinguish refill proof photos
//
// Returns: { url: string; key: string }
//   url  → public OSS URL
//   key  → same as url; used by the archive job to locate + delete the file

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadToOss, ossObjectExists } from '@/lib/oss';

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

async function resolveFilename(prefix: string, filename: string): Promise<string> {
  const dot  = filename.lastIndexOf('.');
  const base = dot !== -1 ? filename.slice(0, dot) : filename;
  const ext  = dot !== -1 ? filename.slice(dot)    : '';
  let candidate = filename;
  let counter   = 2;
  while (await ossObjectExists(`${prefix}/${candidate}`)) {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }
  return candidate;
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
    const kind      = form.get('kind') as string | null;

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

    const storeSlug = slugify(storeName ?? 'store');
    const date      = todayStr();
    const ext       = safeExt(file);
    const kindSlug  = kind ? slugify(kind) : '';
    const filename  = `${storeSlug}_${date}${kindSlug ? `_${kindSlug}` : ''}.${ext}`;
    const finalName = await resolveFilename('petty-cash', filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToOss(buffer, `petty-cash/${finalName}`, file.type);

    return NextResponse.json({ url, key: url }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/upload/petty-cash]', err);
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }
}