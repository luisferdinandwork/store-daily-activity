// app/api/employee/tasks/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_MB  = 10;

type PhotoType =
  | 'store_front' | 'cash_drawer' | 'selfie'
  | 'money' | 'receiving'
  | 'edc_summary' | 'edc_settlement' | 'z_report' | 'open_statement';

const PHOTO_FOLDER: Record<PhotoType, string> = {
  store_front:    'store-opening/store-front',
  cash_drawer:    'store-opening/cash-drawer',
  money:          'setoran/money',
  receiving:      'receiving',
  selfie:         'grooming/selfie',
  edc_summary:    'edc/summary',
  edc_settlement: 'edc/settlement',
  z_report:       'eod/z-report',
  open_statement: 'eod/open-statement',
};

const PHOTO_LIMITS: Record<PhotoType, number> = {
  store_front:    3,
  cash_drawer:    2,
  money:          3,
  receiving:      5,
  selfie:         2,
  edc_summary:    3,
  edc_settlement: 3,
  z_report:       3,
  open_statement: 3,
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData  = await request.formData();
    const file      = formData.get('file')      as File   | null;
    const photoType = formData.get('photoType') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only image files are allowed (JPEG, PNG, WebP, HEIC)' },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File size must be under ${MAX_SIZE_MB}MB` },
        { status: 400 },
      );
    }

    if (!photoType || !(photoType in PHOTO_FOLDER)) {
      return NextResponse.json(
        { error: `photoType must be one of: ${Object.keys(PHOTO_FOLDER).join(', ')}` },
        { status: 400 },
      );
    }

    const folder      = PHOTO_FOLDER[photoType as PhotoType];
    const timestamp   = Date.now();
    const ext         = file.name.split('.').pop() ?? 'jpg';
    const safeName    = `${session.user.id}-${timestamp}.${ext}`;
    const storagePath = `tasks/${folder}/${safeName}`;

    let url: string;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      // ── Vercel Blob (production) ─────────────────────────────────────────
      // Dynamic import avoids the bundler trying to resolve the package at
      // build time when it may not be installed locally.
      const { put } = await import('@vercel/blob');
      const blob    = await put(storagePath, file, { access: 'public' });
      url = blob.url;
    } else {
      // ── Local filesystem (development) ───────────────────────────────────
      const bytes     = await file.arrayBuffer();
      const buffer    = Buffer.from(bytes);
      const uploadDir = join(process.cwd(), 'public', 'uploads', 'tasks', folder);

      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      await writeFile(join(uploadDir, safeName), buffer);
      url = `/uploads/tasks/${folder}/${safeName}`;
    }

    return NextResponse.json({
      url,
      photoType,
      maxAllowed: PHOTO_LIMITS[photoType as PhotoType],
    });
  } catch (error) {
    console.error('[POST /api/employee/tasks/upload]', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}