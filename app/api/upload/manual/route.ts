// app/api/upload/manual/route.ts
// Saves Knowledge Manual files to /public/manuals/ — Ops HO/admin uploads a
// store-operations manual (PDF/Word/Excel/image) that becomes visible to
// every employee. Same whitelist/shape as /api/upload/issue-ba/route.ts.
//
// Expects multipart/form-data with:
//   file — a single File
// Returns: { url: string, fileType: string }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir, access } from 'fs/promises';
import path from 'path';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function safeExt(file: File): string {
  const fromMime = MIME_EXT[file.type];
  if (fromMime) return fromMime;

  const parts = file.name.split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1].toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }
  return 'bin';
}

async function resolveFilename(dir: string, filename: string): Promise<string> {
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

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const title = form.get('title') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!(file.type in MIME_EXT)) {
      return NextResponse.json(
        { error: 'Only images, PDF, Word, or Excel files are allowed.' },
        { status: 415 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 15MB).' }, { status: 413 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'manuals');
    await mkdir(uploadDir, { recursive: true });

    const ext      = safeExt(file);
    const slug     = slugify(title ?? file.name.replace(/\.[^.]+$/, ''));
    const filename = await resolveFilename(uploadDir, `${slug}.${ext}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);

    return NextResponse.json({ url: `/manuals/${filename}`, fileType: ext }, { status: 201 });

  } catch (err) {
    console.error('[POST /api/upload/manual]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
