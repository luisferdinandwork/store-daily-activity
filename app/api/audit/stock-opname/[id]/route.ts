// app/api/audit/stock-opname/[id]/route.ts
//
//   GET    → the whole record (what the Berita Acara SO and the Surat Pernyataan print)
//   PATCH  → kop / Surat / tanda tangan texts (nomor, kota, tanggal, nama toko, brand, lokasi, penandatangan)
//   DELETE → removes the Stock Opname

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { deleteStockOpname, getStockOpnameById, updateSoHeader } from '@/lib/db/utils/audit-stock-opname';

type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  try {
    const so = await getStockOpnameById(id);
    if (!so) return NextResponse.json({ success: false, error: 'Berita Acara SO tidak ditemukan.' }, { status: 404 });
    return NextResponse.json({ success: true, so });
  } catch (error) {
    console.error('[audit/stock-opname/id] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat Berita Acara SO.' }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body tidak valid.' }, { status: 400 });
  }

  try {
    const result = await updateSoHeader(id, body);
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true, so: result.data });
  } catch (error) {
    console.error('[audit/stock-opname/id] PATCH failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  try {
    const result = await deleteStockOpname(id);
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    console.warn(`[audit/stock-opname] #${id} deleted by ${scope.userId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[audit/stock-opname/id] DELETE failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menghapus.' }, { status: 500 });
  }
}
