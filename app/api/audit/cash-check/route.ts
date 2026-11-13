// app/api/audit/cash-check/route.ts
//
// Audit Pemeriksaan Kas — one store, one Jakarta day (lib/db/utils/audit-cash-check.ts).
//
//   GET ?storeId=N&date=YYYY-MM-DD[&part=modal|petty]
//       → { context (store, staff, default Pemegang Kas), check (saved record or null),
//           modalRef (part=modal: staff's own Cek Uang Modal that day),
//           petty   (part=petty: the checklist — live lines merged with what was saved) }
//   PUT { part: 'modal' | 'petty', storeId, date, … } → saves that half, creating the Berita Acara on first save.
//
// Audit + IT only (proxy rule on /api/audit + resolveAuditScope).

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { isDay } from '@/lib/audit-cash-check';
import { periodRangeLabel } from '@/lib/petty-cash-period';
import {
  getCashCheck,
  getModalReference,
  getPettyCandidates,
  getStoreContext,
  mergeChecklist,
  saveModalCheck,
  savePettyCheck,
  type PettyPeriodGroup,
} from '@/lib/db/utils/audit-cash-check';

export async function GET(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  const url = new URL(req.url);
  const storeId = Number(url.searchParams.get('storeId'));
  const date = url.searchParams.get('date') ?? '';
  const part = url.searchParams.get('part');
  if (!Number.isInteger(storeId) || storeId <= 0 || !isDay(date)) {
    return NextResponse.json({ success: false, error: 'storeId dan date wajib diisi.' }, { status: 400 });
  }

  try {
    const context = await getStoreContext(storeId);
    if (!context) return NextResponse.json({ success: false, error: 'Toko tidak ditemukan.' }, { status: 404 });
    const check = await getCashCheck(storeId, date);

    const modalRef = part === 'modal' ? await getModalReference(storeId, date) : undefined;

    let petty: (Awaited<ReturnType<typeof getPettyCandidates>> & { periods: (PettyPeriodGroup & { savedOnly?: boolean })[] }) | undefined;
    if (part === 'petty') {
      const candidates = await getPettyCandidates(storeId, date);
      const saved = check?.pettyItems ?? [];
      const live = candidates.periods.flatMap((p) => p.items);
      const merged = mergeChecklist(live, saved);
      const groups: (PettyPeriodGroup & { savedOnly?: boolean })[] = candidates.periods.map((p) => ({
        ...p,
        items: merged.filter((i) => i.periodMonth === p.month),
      }));
      // Lines saved earlier that Finance has covered since (or of a period that is no longer in view) stay, as saved.
      for (const item of merged) {
        if (groups.some((g) => g.month === item.periodMonth)) continue;
        groups.unshift({
          month: item.periodMonth,
          rangeLabel: periodRangeLabel(item.periodMonth),
          refillState: 'received',
          verifiedAt: null,
          pendingRefill: 0,
          items: merged.filter((i) => i.periodMonth === item.periodMonth),
          savedOnly: true,
        });
      }
      petty = { ...candidates, periods: groups.sort((a, b) => a.month.localeCompare(b.month)) };
    }

    return NextResponse.json({ success: true, context, check, modalRef, petty });
  } catch (error) {
    console.error('[audit/cash-check] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat data pemeriksaan kas.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body tidak valid.' }, { status: 400 });
  }

  const storeId = Number(body.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ success: false, error: 'Toko wajib dipilih.' }, { status: 400 });
  }
  const base = {
    storeId,
    date: String(body.date ?? ''),
    holderUserId: typeof body.holderUserId === 'string' ? body.holderUserId : null,
  };

  try {
    const result =
      body.part === 'modal'
        ? await saveModalCheck(scope.userId, {
            ...base,
            modalBook: body.modalBook,
            salesCash: body.salesCash,
            salesDebit: body.salesDebit,
            salesCredit: body.salesCredit,
            salesVoucher: body.salesVoucher,
            counts: body.counts,
            notes: body.notes,
          })
        : body.part === 'petty'
          ? await savePettyCheck(scope.userId, {
              ...base,
              items: body.items,
              extras: body.extras,
              pendingRefill: body.pendingRefill,
              counts: body.counts,
              notes: body.notes,
            })
          : ({ success: false, error: 'part harus modal atau petty.', status: 400 } as const);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    }
    return NextResponse.json({ success: true, check: result.data });
  } catch (error) {
    console.error('[audit/cash-check] PUT failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan pemeriksaan kas.' }, { status: 500 });
  }
}
