// app/api/audit/berita-acara/[id]/route.ts
//
//   GET    → the whole record (what the Berita Acara prints)
//   PATCH  → header + signature texts (nomor, kota, tanggal, pemegang kas, penandatangan)
//   DELETE → removes the Berita Acara (both halves)

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { deleteCashCheck, getCashCheckById, updateHeader } from '@/lib/db/utils/audit-cash-check';

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
    const check = await getCashCheckById(id);
    if (!check) return NextResponse.json({ success: false, error: 'Berita Acara tidak ditemukan.' }, { status: 404 });
    return NextResponse.json({ success: true, check });
  } catch (error) {
    console.error('[audit/berita-acara/id] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat Berita Acara.' }, { status: 500 });
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
    const result = await updateHeader(id, body);
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true, check: result.data });
  } catch (error) {
    console.error('[audit/berita-acara/id] PATCH failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  try {
    const result = await deleteCashCheck(id);
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    console.warn(`[audit/berita-acara] #${id} deleted by ${scope.userId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[audit/berita-acara/id] DELETE failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menghapus.' }, { status: 500 });
  }
}
