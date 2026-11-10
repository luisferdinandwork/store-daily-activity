// lib/db/utils/store-day-detail.ts
//
// Data behind the detail panel of Finance's "Daily Report All Store": one store on one SALES day D —
// the Store Closing of D, and the Setoran submitted the morning after (D + 1), which is what
// the sheet's cash columns come from (lib/store-closing-money.ts). Day buckets are read the
// Jakarta way (lib/day-bucket.ts); the same day can sit in the tables under both encodings,
// so the row that actually holds figures wins, like in the report itself.

import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  areas,
  setoranMoneyStorage,
  setoranTasks,
  storeClosingEdcEntries,
  storeClosingTasks,
  stores,
  users,
} from '@/lib/db/schema';
import { addDaysKey, jakartaDaysRange } from '@/lib/day-bucket';
import { getLatestCorrectionsByTask } from '@/lib/db/utils/setoran-correction';
import { toEdcEntries } from '@/lib/store-closing-edc';
import { bankTotals } from '@/lib/store-closing-money';
import type {
  ClosingState,
  DayClosingDetail,
  DaySetoranDetail,
  DetailPerson,
  DetailPhoto,
  StoreDayDetail,
} from '@/lib/store-money-detail';

const toInt = (v: string | number | null | undefined): number =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Math.round(Number(v));

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

/** A stored photo as a panel photo; no URL = the store never uploaded it. */
const photo = (p: { key: string; label: string; url: string | null | undefined; at: Date | null | undefined }): DetailPhoto | null =>
  p.url ? { key: p.key, label: p.label, url: p.url, at: iso(p.at) } : null;

const present = (list: (DetailPhoto | null)[]): DetailPhoto[] => list.filter((p): p is DetailPhoto => p !== null);

export async function getStoreDayDetail(storeId: number, salesDate: string): Promise<StoreDayDetail | null> {
  const setoranDate = addDaysKey(salesDate, 1);
  const closingRange = jakartaDaysRange(salesDate, salesDate);
  const setoranRange = jakartaDaysRange(setoranDate, setoranDate);

  const [[store], closingRows, ledgerRows] = await Promise.all([
    db
      .select({ storeNo: stores.storeNo, name: stores.name, areaName: areas.name })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(eq(stores.id, storeId))
      .limit(1),
    db
      .select()
      .from(storeClosingTasks)
      .where(and(
        eq(storeClosingTasks.storeId, storeId),
        gte(storeClosingTasks.date, closingRange.start),
        lt(storeClosingTasks.date, closingRange.end),
      )),
    db
      .select()
      .from(setoranMoneyStorage)
      .where(and(
        eq(setoranMoneyStorage.storeId, storeId),
        gte(setoranMoneyStorage.date, setoranRange.start),
        lt(setoranMoneyStorage.date, setoranRange.end),
      )),
  ]);
  if (!store) return null;

  const edcRows = closingRows.length
    ? await db
        .select({
          taskId: storeClosingEdcEntries.taskId,
          bank: storeClosingEdcEntries.bank,
          method: storeClosingEdcEntries.method,
          amount: storeClosingEdcEntries.amount,
        })
        .from(storeClosingEdcEntries)
        .where(inArray(storeClosingEdcEntries.taskId, closingRows.map((t) => t.id)))
    : [];

  // Closing: the submitted one with the most figures. Setoran: the ledger row with the most money on it.
  const weight = (t: (typeof closingRows)[number]) =>
    (t.status === 'completed' ? 1000 : 0) + edcRows.filter((e) => e.taskId === t.id).length + (t.opMeVoucherAmount != null ? 1 : 0);
  const closing = [...closingRows].sort((a, b) => weight(b) - weight(a))[0] ?? null;
  const ledger = [...ledgerRows].sort((a, b) => toInt(b.actualReceivedAmount) + toInt(b.storedAmount) - toInt(a.actualReceivedAmount) - toInt(a.storedAmount))[0] ?? null;

  const [setoranTask, corrections] = await Promise.all([
    ledger
      ? db.select().from(setoranTasks).where(eq(setoranTasks.id, ledger.taskId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    getLatestCorrectionsByTask(ledger ? [ledger.taskId] : []),
  ]);

  // Names of everyone shown.
  const userIds = new Set<string>();
  const add = (id: string | null | undefined) => { if (id) userIds.add(id); };
  if (closing) [closing.completedBy, closing.heldBy, closing.edcSummaryBy, closing.userId].forEach(add);
  if (ledger) [ledger.completedBy, ledger.userId].forEach(add);
  if (setoranTask) [setoranTask.completedBy, setoranTask.verifiedBy].forEach(add);

  const userRows = userIds.size
    ? await db.select({ id: users.id, name: users.name, nik: users.nik }).from(users).where(inArray(users.id, [...userIds]))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const person = (id: string | null | undefined): DetailPerson | null => {
    const u = id ? userById.get(id) : undefined;
    // A deleted user's NIK was renamed `<nik>~deleted~<id8>` — show the original.
    return u ? { name: u.name, nik: u.nik.split('~')[0] || null } : null;
  };

  // ── Setoran (filed the morning after) ──
  let setoran: DaySetoranDetail | null = null;
  if (ledger) {
    const correction = corrections.get(ledger.taskId) ?? null;
    setoran = {
      date: setoranDate,
      submittedBy: person(ledger.completedBy ?? setoranTask?.completedBy ?? ledger.userId),
      submittedAt: iso(setoranTask?.completedAt),

      received: toInt(ledger.actualReceivedAmount),
      carryIn: toInt(ledger.previousUnpaidAmount),
      required: toInt(ledger.requiredStoreAmount),
      stored: toInt(ledger.storedAmount),
      unpaid: toInt(ledger.unpaidAmount),
      isNoSetoran: ledger.isNoSetoran,

      notes: ledger.notes?.trim() || null,
      verifiedBy: person(setoranTask?.verifiedBy),
      verifiedAt: iso(setoranTask?.verifiedAt),
      correction: correction ? { by: correction.by, reason: correction.reason, at: correction.at, kind: correction.kind } : null,

      // The ledger row is what was submitted; the task only holds a draft's columns.
      photos: present([
        photo({ key: 'resi', label: 'Foto resi', url: ledger.resiPhoto ?? setoranTask?.resiPhoto, at: ledger.resiPhotoAt }),
        photo({ key: 'atmSelfie', label: 'Selfie kartu ATM', url: ledger.atmCardSelfiePhoto ?? setoranTask?.atmCardSelfiePhoto, at: ledger.atmCardSelfiePhotoAt }),
        photo({ key: 'cashier', label: 'Foto sisa setoran', url: ledger.cashierPhoto ?? setoranTask?.cashierPhoto, at: ledger.cashierPhotoAt }),
        photo({ key: 'atmCard', label: 'Foto kartu ATM', url: ledger.atmCardPhoto ?? setoranTask?.atmCardPhoto, at: ledger.atmCardPhotoAt }),
      ]),
    };
  }

  // ── Store Closing (of the sales day) ──
  let closingDetail: DayClosingDetail | null = null;
  if (closing) {
    const entries = toEdcEntries(edcRows.filter((e) => e.taskId === closing.id));
    const state: ClosingState = closing.status === 'completed' ? 'posted' : closing.isOnHold ? 'on_hold' : 'draft';
    const submitter = closing.completedBy ?? closing.heldBy ?? closing.edcSummaryBy ?? closing.userId;

    closingDetail = {
      state,
      holdReason: state === 'on_hold' ? closing.openStatementHoldReason?.trim() || null : null,
      submittedBy: person(submitter),
      submittedAt: iso(closing.completedAt ?? closing.heldAt ?? closing.edcSummaryAt),

      banks: bankTotals(entries),
      opMeVoucher: closing.opMeVoucherAmount != null ? Number(closing.opMeVoucherAmount) : null,

      zReportPhoto: photo({
        key: 'zreport',
        label: 'Z-Report & EDC Settlement',
        url: closing.eodEdcSettlementPhoto,
        at: closing.eodEdcSettlementPhotoAt,
      }),
      indodanaPhoto: photo({
        key: 'indodana',
        label: 'Dashboard Indodana',
        url: closing.indodanaDashboardPhoto,
        at: closing.indodanaDashboardPhotoAt,
      }),
    };
  }

  return {
    storeNo: store.storeNo,
    storeName: store.name,
    areaName: store.areaName,
    salesDate,
    setoranDate,
    setoran,
    closing: closingDetail,
  };
}
