// app/api/employee/tasks/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_MB = 10;

type PhotoType =
  // New Store Front task
  | 'storefront'
  | 'rolling_door_closed'

  // Backward-compatible alias. Prefer `storefront` on the frontend.
  | 'store_front'

  // Store Opening task
  | 'cashier_desk'
  | 'five_r_kasir'
  | 'five_r_depan'
  | 'five_r_kanan'
  | 'five_r_kiri'
  | 'five_r_gudang'

  // Other employee tasks
  | 'grooming_selfie'
  | 'resi'
  | 'atm_card_selfie'
  | 'item_dropping'
  | 'item_dropping_receive'
  | 'z_report';

const PHOTO_FOLDER: Record<PhotoType, string> = {
  // New Store Front task folders
  storefront: 'store-front/storefront',
  rolling_door_closed: 'store-front/rolling-door-closed',

  // Backward-compatible alias for existing frontend calls.
  store_front: 'store-front/storefront',

  // Store Opening task folders
  cashier_desk: 'store-opening/cashier-desk',
  five_r_kasir: 'store-opening/five-r/kasir',
  five_r_depan: 'store-opening/five-r/depan',
  five_r_kanan: 'store-opening/five-r/kanan',
  five_r_kiri: 'store-opening/five-r/kiri',
  five_r_gudang: 'store-opening/five-r/gudang',

  // Other task folders
  resi: 'setoran/resi',
  atm_card_selfie: 'setoran/atm-card-selfie',
  item_dropping: 'item-dropping/drop',
  item_dropping_receive: 'item-dropping/receive',
  grooming_selfie: 'grooming/selfie',
  z_report: 'eod/z-report',
};

const PHOTO_LIMITS: Record<PhotoType, number> = {
  storefront: 3,
  rolling_door_closed: 1,

  // Backward-compatible alias.
  store_front: 3,

  cashier_desk: 2,
  five_r_kasir: 2,
  five_r_depan: 2,
  five_r_kanan: 2,
  five_r_kiri: 2,
  five_r_gudang: 2,
  resi: 1,
  atm_card_selfie: 1,
  item_dropping: 5,
  item_dropping_receive: 5,
  grooming_selfie: 3,
  z_report: 3,
};

function sanitizeExtension(fileName: string, mimeType: string): string {
  const rawExt = fileName.split('.').pop()?.toLowerCase();

  if (rawExt && /^[a-z0-9]+$/.test(rawExt)) {
    return rawExt;
  }

  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';

  return 'jpg';
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
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

    const typedPhotoType = photoType as PhotoType;
    const folder = PHOTO_FOLDER[typedPhotoType];
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const ext = sanitizeExtension(file.name, file.type);
    const safeName = `${session.user.id}-${timestamp}-${random}.${ext}`;
    const storagePath = `tasks/${folder}/${safeName}`;

    let url: string;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const blob = await put(storagePath, file, { access: 'public' });
      url = blob.url;
    } else {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const uploadDir = join(process.cwd(), 'public', 'uploads', 'tasks', folder);

      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      await writeFile(join(uploadDir, safeName), buffer);
      url = `/uploads/tasks/${folder}/${safeName}`;
    }

    return NextResponse.json({
      url,
      photoType: typedPhotoType,
      maxAllowed: PHOTO_LIMITS[typedPhotoType],
    });
  } catch (error) {
    console.error('[POST /api/employee/tasks/upload]', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
