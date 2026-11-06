// app/api/it/warehouse-codes/route.ts
// GET    — listed + automatic ("DM…") warehouse codes and the unrecognised codes seen on transfer orders.
// POST   — { code, name? } lists a code as a warehouse (and unlinks it from any store on existing orders).
// PATCH  — { id, name } renames a listed code.
// DELETE — ?id= removes a listed code (the "DM…" rule itself cannot be removed).
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import {
  addWarehouseCode,
  getWarehouseCodeOverview,
  removeWarehouseCode,
  updateWarehouseName,
} from '@/lib/db/utils/warehouse-codes';
import {
  WAREHOUSE_NAME_MAX,
  normalizeWarehouseCode,
  validateWarehouseCode,
} from '@/lib/warehouse-codes';

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

function cleanName(raw: unknown): string | null | 'too_long' {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > WAREHOUSE_NAME_MAX ? 'too_long' : t;
}

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);
  try {
    return NextResponse.json({ success: true, ...(await getWarehouseCodeOverview()) });
  } catch (err) {
    console.error('[GET /api/it/warehouse-codes]', err);
    return fail('Gagal memuat kode gudang.', 500);
  }
}

export async function POST(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  const body = await req.json().catch(() => null);
  const code = normalizeWarehouseCode(String(body?.code ?? ''));
  const problem = validateWarehouseCode(code);
  if (problem) return fail(problem);
  const name = cleanName(body?.name);
  if (name === 'too_long') return fail(`Nama maksimal ${WAREHOUSE_NAME_MAX} karakter.`);

  try {
    const res = await addWarehouseCode(code, name, scope.userId);
    if (!res.success) return fail(res.error, 409);
    console.info(`[warehouse-codes] ${code} added by ${scope.userId} (${res.unlinked} orders unlinked from a store)`);
    return NextResponse.json({
      success: true,
      ...(await getWarehouseCodeOverview()),
      message: `${code} sekarang dikenali sebagai gudang.`,
    });
  } catch (err) {
    console.error('[POST /api/it/warehouse-codes]', err);
    return fail('Gagal menyimpan kode gudang.', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail('id tidak valid.');
  const name = cleanName(body?.name);
  if (name === 'too_long') return fail(`Nama maksimal ${WAREHOUSE_NAME_MAX} karakter.`);

  try {
    if (!(await updateWarehouseName(id, name))) return fail('Kode tidak ditemukan.', 404);
    return NextResponse.json({ success: true, ...(await getWarehouseCodeOverview()), message: 'Nama disimpan.' });
  } catch (err) {
    console.error('[PATCH /api/it/warehouse-codes]', err);
    return fail('Gagal menyimpan nama.', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) return fail(scope.error, scope.status);

  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id)) return fail('id tidak valid.');

  try {
    if (!(await removeWarehouseCode(id))) return fail('Kode tidak ditemukan.', 404);
    return NextResponse.json({ success: true, ...(await getWarehouseCodeOverview()), message: 'Kode dihapus dari daftar.' });
  } catch (err) {
    console.error('[DELETE /api/it/warehouse-codes]', err);
    return fail('Gagal menghapus kode.', 500);
  }
}
