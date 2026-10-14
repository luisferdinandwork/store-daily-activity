// lib/db/utils/store-closing-money.ts
//
// Data behind Finance's Store Closing · Report: for a period of sales days, one
// row per store per day — the EDC money from that day's Store Closing plus the
// cash from the Setoran submitted the next morning (see lib/store-closing-money.ts
// for how the two are paired). Only submitted setoran count: the ledger row
// (setoran_money_storage) is written when the setoran is submitted.
//
// Day buckets are read/queried the Jakarta way (lib/day-bucket.ts), so both stored
// encodings of a day land on the right row.

import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  areas,
  setoranMoneyStorage,
  storeClosingEdcEntries,
  storeClosingTasks,
  stores,
} from '@/lib/db/schema';
import { addDaysKey, jakartaDateKey, jakartaDaysRange } from '@/lib/day-bucket';
import { toEdcEntries } from '@/lib/store-closing-edc';
import {
  bankTotals,
  emptyBanks,
  storeCodeOf,
  type ClosingMoneyReport,
  type ClosingMoneyRow,
  type ClosingMoneySetoran,
} from '@/lib/store-closing-money';

const toInt = (v: string | number | null | undefined): number =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Math.round(Number(v));

const byStoreThenDate = (a: ClosingMoneyRow, b: ClosingMoneyRow) =>
  a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }) || a.salesDate.localeCompare(b.salesDate);

export async function getClosingMoneyReport(
  from: string,
  to: string,
  storeId: number | null,
): Promise<ClosingMoneyReport> {
  // Sales days from..to; their setoran is filed on the following days.
  const closingRange = jakartaDaysRange(from, to);
  const setoranRange = jakartaDaysRange(addDaysKey(from, 1), addDaysKey(to, 1));

  const [closingRows, ledgerRows] = await Promise.all([
    db
      .select({
        id: storeClosingTasks.id,
        storeId: storeClosingTasks.storeId,
        date: storeClosingTasks.date,
        status: storeClosingTasks.status,
        opMeVoucher: storeClosingTasks.opMeVoucherAmount,
      })
      .from(storeClosingTasks)
      .where(and(
        gte(storeClosingTasks.date, closingRange.start),
        lt(storeClosingTasks.date, closingRange.end),
        storeId != null ? eq(storeClosingTasks.storeId, storeId) : undefined,
      )),
    db
      .select({
        taskId: setoranMoneyStorage.taskId,
        storeId: setoranMoneyStorage.storeId,
        date: setoranMoneyStorage.date,
        received: setoranMoneyStorage.actualReceivedAmount,
        carryIn: setoranMoneyStorage.previousUnpaidAmount,
        required: setoranMoneyStorage.requiredStoreAmount,
        stored: setoranMoneyStorage.storedAmount,
        unpaid: setoranMoneyStorage.unpaidAmount,
        isNoSetoran: setoranMoneyStorage.isNoSetoran,
        notes: setoranMoneyStorage.notes,
      })
      .from(setoranMoneyStorage)
      .where(and(
        gte(setoranMoneyStorage.date, setoranRange.start),
        lt(setoranMoneyStorage.date, setoranRange.end),
        storeId != null ? eq(setoranMoneyStorage.storeId, storeId) : undefined,
      )),
  ]);

  const taskIds = closingRows.map((t) => t.id);
  const edcRows = taskIds.length
    ? await db
        .select({
          taskId: storeClosingEdcEntries.taskId,
          bank: storeClosingEdcEntries.bank,
          method: storeClosingEdcEntries.method,
          amount: storeClosingEdcEntries.amount,
        })
        .from(storeClosingEdcEntries)
        .where(inArray(storeClosingEdcEntries.taskId, taskIds))
    : [];

  const edcByTask = new Map<number, { bank: string; method: string; amount: string }[]>();
  for (const e of edcRows) {
    const list = edcByTask.get(e.taskId);
    if (list) list.push(e);
    else edcByTask.set(e.taskId, [e]);
  }

  // Card side, keyed by store + sales day. The same day can sit in the table under
  // both encodings; keep the one that actually holds figures.
  const sideKey = (id: number, day: string) => `${id}:${day}`;
  type Card = Pick<ClosingMoneyRow, 'banks' | 'opMeVoucher'> & { weight: number };
  const cards = new Map<string, Card>();
  for (const t of closingRows) {
    const entries = toEdcEntries(edcByTask.get(t.id) ?? []);
    const opMeVoucher = t.opMeVoucher != null ? Number(t.opMeVoucher) : null;
    const hasFigures = entries.length > 0 || opMeVoucher !== null;
    // A closing nobody has filled in or submitted yet is just an empty draft.
    if (!hasFigures && t.status !== 'completed' && t.status !== 'pending') continue;

    const key = sideKey(t.storeId, jakartaDateKey(t.date));
    const card: Card = { banks: bankTotals(entries), opMeVoucher, weight: entries.length + (opMeVoucher !== null ? 1 : 0) };
    const prev = cards.get(key);
    if (!prev || card.weight > prev.weight) cards.set(key, card);
  }

  // Cash side, keyed by store + the SALES day (the setoran day minus one).
  const cash = new Map<string, ClosingMoneySetoran>();
  for (const l of ledgerRows) {
    const key = sideKey(l.storeId, addDaysKey(jakartaDateKey(l.date), -1));
    const setoran: ClosingMoneySetoran = {
      taskId: l.taskId,
      received: toInt(l.received),
      carryIn: toInt(l.carryIn),
      required: toInt(l.required),
      stored: toInt(l.stored),
      unpaid: toInt(l.unpaid),
      isNoSetoran: l.isNoSetoran,
      notes: l.notes?.trim() || null,
    };
    const prev = cash.get(key);
    if (!prev || setoran.received + setoran.stored > prev.received + prev.stored) cash.set(key, setoran);
  }

  const keys = new Set([...cards.keys(), ...cash.keys()]);
  const storeIds = [...new Set([...keys].map((k) => Number(k.split(':')[0])))];
  if (storeIds.length === 0) return { from, to, rows: [], stores: [] };

  const storeRows = await db
    .select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaName: areas.name })
    .from(stores)
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .where(inArray(stores.id, storeIds));
  const storeMap = new Map(storeRows.map((s) => [s.id, s]));

  const rows: ClosingMoneyRow[] = [];
  for (const key of keys) {
    const [idPart, salesDate] = key.split(':');
    const store = storeMap.get(Number(idPart));
    if (!store || salesDate < from || salesDate > to) continue;

    const card = cards.get(key);
    rows.push({
      key,
      storeId: store.id,
      storeNo: store.storeNo,
      storeName: store.name,
      areaName: store.areaName,
      code: storeCodeOf(store.storeNo),
      salesDate,
      setoranDate: addDaysKey(salesDate, 1),
      hasClosing: Boolean(card),
      banks: card?.banks ?? emptyBanks(),
      opMeVoucher: card?.opMeVoucher ?? null,
      setoran: cash.get(key) ?? null,
    });
  }
  rows.sort(byStoreThenDate);

  const stores_ = storeRows
    .map((s) => ({ id: s.id, storeNo: s.storeNo, name: s.name }))
    .sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));

  return { from, to, rows, stores: stores_ };
}
