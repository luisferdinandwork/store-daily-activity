// lib/bin-round-routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side only: the request handling shared by the Ops (/api/ops/bin-check…) and Audit
// (/api/audit/bin-progress…) "Progres Cek Bin" routes, so both panels answer the same way. Each route only decides
// WHO is asking (opsRoundScope / auditRoundScope) — an OPS Area user is held to their own area, Ops HO / IT /
// Audit see every active store.
//
//   GET  overview   ?month=YYYY-MM[&refresh=1]        → { success, data: BinProgressOverview }
//   GET  detail     /<storeId>?month=YYYY-MM[&refresh=1] → { success, data: BinProgressDetail }
//   POST sync       /<storeId> {}                      → { success, queued } (reads the store's bin list from BC
//                                                         again, in the background)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';

import { guardApi } from '@/lib/auth/guards';
import { loadOpsActor } from '@/lib/auth/ops-actor';
import { resolveAuditScope } from '@/lib/audit/scope';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { isYearMonth, yearMonthOfDay } from '@/lib/bin-round';
import { getBinProgressDetail, getBinProgressOverview, listRoundStores, requestBinListSync } from '@/lib/db/utils/bin-round';

export type RoundScope = { ok: true; areaId: number | null } | { ok: false; status: number; error: string };

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function opsRoundScope(): Promise<RoundScope> {
  const guard = await guardApi(['ops', 'it']);
  if (!guard.ok) return { ok: false, status: guard.response.status, error: 'Forbidden' };
  const actor = await loadOpsActor(guard.user.id);
  if (!actor) return { ok: false, status: 403, error: 'Forbidden' };
  if (actor.isOpsHo) return { ok: true, areaId: null };
  if (!actor.areaId) return { ok: false, status: 403, error: 'OPS user has no area assigned.' };
  return { ok: true, areaId: actor.areaId };
}

export async function auditRoundScope(): Promise<RoundScope> {
  const scope = await resolveAuditScope();
  return scope.ok ? { ok: true, areaId: null } : { ok: false, status: scope.status, error: scope.error };
}

function monthOf(req: Request): string | null {
  const raw = new URL(req.url).searchParams.get('month');
  const current = yearMonthOfDay(jakartaTodayKey());
  if (!raw) return current;
  if (!isYearMonth(raw) || raw > current) return null;
  return raw;
}

function storeIdOf(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function handleOverview(req: Request, scope: RoundScope) {
  if (!scope.ok) return fail(scope.error, scope.status);
  const month = monthOf(req);
  if (!month) return fail('Bulan tidak valid.', 400);
  try {
    const list = await listRoundStores({ areaId: scope.areaId });
    const data = await getBinProgressOverview({
      yearMonth: month,
      stores: list,
      force: new URL(req.url).searchParams.get('refresh') === '1',
    });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[bin-round] overview failed', err);
    return fail('Gagal memuat progres cek bin.', 500);
  }
}

export async function handleDetail(req: Request, scope: RoundScope, rawStoreId: string) {
  if (!scope.ok) return fail(scope.error, scope.status);
  const month = monthOf(req);
  if (!month) return fail('Bulan tidak valid.', 400);
  const storeId = storeIdOf(rawStoreId);
  if (!storeId) return fail('Toko tidak valid.', 400);
  try {
    const [store] = await listRoundStores({ areaId: scope.areaId, storeId });
    if (!store) return fail('Toko tidak ditemukan di area Anda.', 404);
    const data = await getBinProgressDetail({ store, yearMonth: month, force: new URL(req.url).searchParams.get('refresh') === '1' });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[bin-round] detail failed', err);
    return fail('Gagal memuat detail cek bin.', 500);
  }
}

export async function handleSync(scope: RoundScope, rawStoreId: string) {
  if (!scope.ok) return fail(scope.error, scope.status);
  const storeId = storeIdOf(rawStoreId);
  if (!storeId) return fail('Toko tidak valid.', 400);
  try {
    const [store] = await listRoundStores({ areaId: scope.areaId, storeId });
    if (!store) return fail('Toko tidak ditemukan di area Anda.', 404);
    const queued = await requestBinListSync([store], { force: true });
    return NextResponse.json({ success: true, queued: queued.length > 0 });
  } catch (err) {
    console.error('[bin-round] sync failed', err);
    return fail('Gagal meminta daftar bin dari BC.', 500);
  }
}
