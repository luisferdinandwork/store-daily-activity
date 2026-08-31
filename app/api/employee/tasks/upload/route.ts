// app/api/employee/tasks/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadToStorage } from '@/lib/storage';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_MB = 10;

type PhotoType =
  // Store Front task
  | 'storefront'
  | 'rolling_door_closed'
  | 'store_front'

  // Store Opening task
  | 'cashier_desk'
  | 'five_r_kasir'
  | 'five_r_depan'
  | 'five_r_kanan'
  | 'five_r_kiri'
  | 'five_r_gudang'

  // Setoran task
  | 'resi'
  | 'atm_card_selfie'

  // Item Return / Item Dropping tasks — one courier-signed-paper photo per
  // transfer-order confirmation (see lib/db/utils/item-transfers.ts).
  | 'item_return_courier_sign'
  | 'item_dropping_courier_sign'

  // Grooming task
  | 'grooming_selfie'

  // Store Closing task
  | 'eod_edc_settlement_photo'

  // Backward-compatible aliases
  | 'eod_edc_settlement'
  | 'z_report';

const PHOTO_FOLDER: Record<PhotoType, string> = {
  // Store Front task folders
  storefront: 'store-front/storefront',
  rolling_door_closed: 'store-front/rolling-door-closed',
  store_front: 'store-front/storefront',

  // Store Opening task folders
  cashier_desk: 'store-opening/cashier-desk',
  five_r_kasir: 'store-opening/five-r/kasir',
  five_r_depan: 'store-opening/five-r/depan',
  five_r_kanan: 'store-opening/five-r/kanan',
  five_r_kiri: 'store-opening/five-r/kiri',
  five_r_gudang: 'store-opening/five-r/gudang',

  // Setoran task folders
  resi: 'setoran/resi',
  atm_card_selfie: 'setoran/atm-card-selfie',

  // Item Return / Item Dropping courier-sign photo folders
  item_return_courier_sign: 'item-return/courier-sign',
  item_dropping_courier_sign: 'item-dropping/courier-sign',

  // Grooming task folders
  grooming_selfie: 'grooming/selfie',

  // Store Closing task folders
  eod_edc_settlement_photo: 'store-closing/eod-edc-settlement',

  // Backward-compatible aliases
  eod_edc_settlement: 'store-closing/eod-edc-settlement',
  z_report: 'store-closing/eod-edc-settlement',
};

const PHOTO_LIMITS: Record<PhotoType, number> = {
  storefront: 3,
  rolling_door_closed: 1,
  store_front: 3,

  cashier_desk: 2,
  five_r_kasir: 2,
  five_r_depan: 2,
  five_r_kanan: 2,
  five_r_kiri: 2,
  five_r_gudang: 2,

  resi: 1,
  atm_card_selfie: 1,

  item_return_courier_sign: 1,
  item_dropping_courier_sign: 1,

  grooming_selfie: 3,

  // Store Closing only needs 1 required side-by-side image.
  eod_edc_settlement_photo: 1,

  // Backward-compatible aliases.
  eod_edc_settlement: 1,
  z_report: 1,
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

function normalizePhotoType(value: string): PhotoType | null {
  if (value in PHOTO_FOLDER) return value as PhotoType;

  // Extra safety for possible frontend naming variants.
  if (value === 'eodEdcSettlementPhoto') return 'eod_edc_settlement_photo';
  if (value === 'eod_edc_settlement_image') return 'eod_edc_settlement_photo';
  if (value === 'store_closing') return 'eod_edc_settlement_photo';

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const rawPhotoType = formData.get('photoType') as string | null;

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

    const typedPhotoType = rawPhotoType ? normalizePhotoType(rawPhotoType) : null;

    if (!typedPhotoType) {
      return NextResponse.json(
        {
          error: `photoType must be one of: ${Object.keys(PHOTO_FOLDER).join(', ')}`,
          received: rawPhotoType,
        },
        { status: 400 },
      );
    }

    const folder = PHOTO_FOLDER[typedPhotoType];
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const ext = sanitizeExtension(file.name, file.type);
    const safeName = `${session.user.id}-${timestamp}-${random}.${ext}`;
    const storagePath = `tasks/${folder}/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToStorage(buffer, storagePath, file.type);

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