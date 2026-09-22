// app/api/upload/issue-ba/route.ts
// Saves Berita Acara (BA) evidence files to Biznet NOS (S3) storage under issue-ba/.
// Unlike /api/upload/issue (camera-only issue-report photos), BA files are
// picked from the device's gallery/file system and may be images OR
// documents (PDF, Word, Excel) — a BA is often a scanned/exported document,
// not a live-verification photo.
//
// Filename format: <sanitized-title>_<sanitized-store>_<YYYY-MM-DD>_<n>.<ext>
//
// Expects multipart/form-data with:
//   files[]   — one or more Files (up to 5)
//   title     — issue title  (used in filename)
//   storeName — store name   (used in filename)
// Returns: { urls: string[] }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadToStorage, storageObjectExists } from '@/lib/storage';
import { validateImageOrDocument } from '@/lib/upload-validation';

// ─── Allowed types ────────────────────────────────────────────────────────────

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — documents can run larger than phone photos

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strips characters that are unsafe in filenames, collapses spaces to hyphens. */
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

// ─── POST /api/upload/issue-ba ─────────────────────────────────────────────────

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
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} files per Berita Acara` }, { status: 400 });
    }

    for (const file of files) {
      const isAllowedType = file.type in MIME_EXT;
      if (!isAllowedType) {
        return NextResponse.json(
          { error: `${file.name}: only images, PDF, Word, or Excel files are allowed.` },
          { status: 415 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is too large (max 15MB).` },
          { status: 413 },
        );
      }
    }

    // Check the actual bytes against the declared type BEFORE uploading anything; the stored
    // extension / Content-Type then come from that check, never from the client's filename.
    const validated: { buffer: Buffer; ext: string; mime: string }[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const checked = validateImageOrDocument(buffer, file.type, { allowHeic: true });
      if (!checked) {
        return NextResponse.json(
          { error: `${file.name}: file content does not match its type.` },
          { status: 415 },
        );
      }
      validated.push({ buffer, ext: checked.ext, mime: checked.mime });
    }

    const titleSlug = slugify(title ?? 'issue');
    const storeSlug = slugify(storeName ?? 'store');
    const date      = todayStr();

    const urls = await Promise.all(
      validated.map(async ({ buffer, ext, mime }, index) => {
        const filename = `${titleSlug}_${storeSlug}_${date}_ba_${index + 1}.${ext}`;

        const finalName = await resolveFilename('issue-ba', filename);

        return uploadToStorage(buffer, `issue-ba/${finalName}`, mime);
      }),
    );

    return NextResponse.json({ urls }, { status: 201 });

  } catch (err) {
    console.error('[POST /api/upload/issue-ba]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
