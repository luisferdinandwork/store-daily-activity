// app/api/audit/cash-check/photo/route.ts
//
// Audit Cek Petty Cash — the receipt photo of a "Pengeluaran lain" line (a cash-out the system does not have).
//
//   POST multipart/form-data { file, storeId, date } → { success, url }
//
// The photo goes to object storage under audit-cash-check/<storeNo>/<day>/ and only its URL is kept on the line
// (audit_cash_checks.petty_extras[].photoUrl, checked again with isStorageUrl on save). JPG / PNG / WebP only —
// the Berita Acara pages are read in desktop browsers, which cannot show HEIC. Audit + IT only.

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { EXTRA_PHOTO_MAX_BYTES, isDay } from '@/lib/audit-cash-check';
import { getStoreContext } from '@/lib/db/utils/audit-cash-check';
import { uploadToStorage } from '@/lib/storage';
import { sniffImageOf } from '@/lib/upload-validation';

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export async function POST(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('Data tidak terbaca. Coba kirim ulang — ukuran foto mungkin terlalu besar.', 400);
  }

  const storeId = Number(form.get('storeId'));
  const date = String(form.get('date') ?? '');
  const file = form.get('file');
  if (!Number.isInteger(storeId) || storeId <= 0 || !isDay(date)) return fail('storeId dan date wajib diisi.', 400);
  if (!(file instanceof File) || file.size === 0) return fail('Foto struk wajib dipilih.', 400);
  if (file.size > EXTRA_PHOTO_MAX_BYTES) return fail('Foto terlalu besar (maksimal 8 MB).', 413);

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageOf(buffer, ['jpg', 'png', 'webp']);
  if (!sniffed) return fail('Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.', 415);

  try {
    const ctx = await getStoreContext(storeId);
    if (!ctx) return fail('Toko tidak ditemukan.', 404);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const url = await uploadToStorage(
      buffer,
      `audit-cash-check/${slug(ctx.store.storeNo)}/${date}/pengeluaran-lain_${stamp}.${sniffed.ext}`,
      sniffed.mime,
    );
    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('[audit/cash-check/photo] upload failed', error);
    return fail('Gagal mengunggah foto. Coba lagi.', 500);
  }
}
