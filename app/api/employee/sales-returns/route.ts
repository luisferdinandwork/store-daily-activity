// app/api/employee/sales-returns/route.ts
//
// Sales Return, staff app.
//
// GET  — the home store's latest returns (newest first), the employee's own marked.
// POST — multipart/form-data: `receiptNumber` + 1–3 `files` (receipt photos); answers
//        with the new row's id (the app then reloads the list).
//        The filer and the time are never taken from the request: the user is the
//        session user, the date is the moment this handler stores the row. Photos
//        go to object storage first (all validated before any is uploaded) and the
//        row is written last; if that write fails the uploads are removed again.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { guardApi } from '@/lib/auth/guards';
import { createSalesReturn, listStoreSalesReturns } from '@/lib/db/utils/sales-returns';
import { assertStoreOperational } from '@/lib/db/utils/store-status';
import { deleteFromStorage, uploadToStorage } from '@/lib/storage';
import { sniffImageOf } from '@/lib/upload-validation';
import {
  SALES_RETURN_MAX_PHOTOS,
  SALES_RETURN_MAX_PHOTO_BYTES,
  SALES_RETURN_MAX_TOTAL_BYTES,
  validateReceiptNumber,
} from '@/lib/sales-returns';
import { todayJakarta } from '@/lib/finance/dates';

// JPEG / PNG / WebP only: Ops and Finance view these in desktop browsers, which
// can't show HEIC. (The staff app re-encodes whatever the phone can decode to JPEG.)
const ALLOWED_EXTS = ['jpg', 'png', 'webp'] as const;

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export async function GET() {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;

  const { homeStoreId, id } = guard.user;
  if (!homeStoreId) return NextResponse.json({ success: true, returns: [] });

  try {
    const returns = await listStoreSalesReturns(homeStoreId, id);
    return NextResponse.json({ success: true, returns });
  } catch (err) {
    console.error('[GET /api/employee/sales-returns]', err);
    return fail('Internal server error', 500);
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardApi(['employee', 'it']);
  if (!guard.ok) return guard.response;

  const { id: userId, homeStoreId } = guard.user;
  if (!homeStoreId) return fail('Kamu belum terdaftar di toko mana pun.', 403);

  const inactive = await assertStoreOperational(homeStoreId);
  if (inactive) return fail(inactive, 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('Data tidak terbaca. Coba kirim ulang — ukuran foto mungkin terlalu besar.', 400);
  }

  const receipt = validateReceiptNumber(String(form.get('receiptNumber') ?? ''));
  if (!receipt.ok) return fail(receipt.error, 400);

  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (files.length === 0) return fail('Foto struk wajib diunggah.', 400);
  if (files.length > SALES_RETURN_MAX_PHOTOS) {
    return fail(`Maksimal ${SALES_RETURN_MAX_PHOTOS} foto per retur.`, 400);
  }
  if (files.some((f) => f.size > SALES_RETURN_MAX_PHOTO_BYTES)) {
    return fail(`Ukuran satu foto maksimal ${SALES_RETURN_MAX_PHOTO_BYTES / 1024 / 1024} MB.`, 413);
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > SALES_RETURN_MAX_TOTAL_BYTES) {
    return fail('Total ukuran foto terlalu besar. Kurangi jumlah foto atau perkecil ukurannya.', 413);
  }

  // Validate every file before uploading any, so a bad second photo can't leave
  // the first orphaned in the bucket. Extension + Content-Type come from the bytes.
  const photos: { buffer: Buffer; ext: string; mime: string }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffImageOf(buffer, ALLOWED_EXTS);
    if (!sniffed) return fail('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.', 415);
    photos.push({ buffer, ext: sniffed.ext, mime: sniffed.mime });
  }

  const [store] = await db
    .select({ storeNo: stores.storeNo })
    .from(stores)
    .where(eq(stores.id, homeStoreId))
    .limit(1);
  if (!store) return fail('Toko tidak ditemukan.', 404);

  const folder = `sales-return/${slug(store.storeNo)}/${todayJakarta()}`;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Indexed, so the photos keep their order and a failed upload still leaves the
  // ones that made it known (to be removed again below).
  const uploaded: (string | undefined)[] = [];
  let saved: { id: number; createdAt: string };
  try {
    await Promise.all(
      photos.map(async ({ buffer, ext, mime }, i) => {
        uploaded[i] = await uploadToStorage(
          buffer,
          `${folder}/${slug(receipt.value)}_${stamp}_${i + 1}.${ext}`,
          mime,
        );
      }),
    );
    saved = await createSalesReturn({
      storeId: homeStoreId,
      userId,
      receiptNumber: receipt.value,
      imageUrls: uploaded as string[],
    });
  } catch (err) {
    console.error('[POST /api/employee/sales-returns]', err);
    // Best effort: don't leave photos behind for a row that was never written.
    const orphans = uploaded.filter((u): u is string => Boolean(u));
    if (orphans.length) await deleteFromStorage(orphans).catch(() => {});
    return fail('Gagal menyimpan retur. Coba lagi.', 500);
  }

  return NextResponse.json({ success: true, id: saved.id, createdAt: saved.createdAt }, { status: 201 });
}
