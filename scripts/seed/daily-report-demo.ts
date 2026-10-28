// scripts/seed/daily-report-demo.ts
//
// Fills Finance's "Daily Report All Store" (/finance/store-sheet) for the current month:
// for every ACTIVE store and every finished sales day D, a Store Closing (bank × QRIS /
// Debit / Credit, OP/ME/VOUCHER, Z-Report photo) and the Setoran filed the morning after
// (D + 1), with Sisa carried from day to day like the real flow.
//
//   npx dotenv -e .env.local -- tsx scripts/seed/daily-report-demo.ts            # dry run
//   npx dotenv -e .env.local -- tsx scripts/seed/daily-report-demo.ts --apply
//   … --month=2026-10   … --store=FF001,FO001   … --replace (overwrite days that already have rows)
//
// Idempotent: rows this script wrote before are rewritten; a store-day that has someone else's
// closing / setoran row is left alone unless --replace. Setoran Tunai is always a multiple of
// Rp 50.000 and the Sisa under Rp 50.000. Figures are deterministic per store + day, so a re-run gives the same numbers.
// Refuses to run against production.

import '../lib/not-production';
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  setoranMoneyStorage,
  setoranTasks,
  shifts,
  storeClosingEdcEntries,
  storeClosingTasks,
  stores,
  users,
} from '@/lib/db/schema';
import {
  addDaysKey,
  daysInMonthKey,
  jakartaDateKey,
  jakartaDayStart,
  jakartaMonthRange,
  jakartaTodayKey,
} from '@/lib/day-bucket';
import { EDC_BANKS } from '@/lib/store-closing-edc';

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const value = (n: string) => flag(n)?.split('=')[1];
const APPLY = Boolean(flag('apply'));
const REPLACE = Boolean(flag('replace'));
const MONTH = value('month') ?? jakartaTodayKey().slice(0, 7);
const ONLY = value('store')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const PHOTO = '/demo/seed-photo.svg';
/** Setoran Tunai is deposited in multiples of this; the remainder (Sisa) stays below it. */
const SETORAN_STEP = 50_000;

/** Small deterministic PRNG so a store-day always gets the same figures. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n: number, to: number) => Math.round(n / to) * to;
const money = (n: number) => n.toFixed(2);

const BANK_WEIGHT: Record<string, number> = { bca: 3, mandiri: 2, bri: 1.5, ocbc: 0.7, indodana: 0.4 };

async function main() {
  const today = jakartaTodayKey();
  const nDays = daysInMonthKey(MONTH);
  // A sales day is finished once its setoran day (D + 1) has begun.
  const salesDays: string[] = [];
  for (let d = 1; d <= nDays; d++) {
    const key = `${MONTH}-${String(d).padStart(2, '0')}`;
    if (addDaysKey(key, 1) <= today) salesDays.push(key);
  }
  if (salesDays.length === 0) throw new Error(`No finished sales days in ${MONTH}.`);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const morning = shiftRows.find((s) => s.code === 'morning');
  const evening = shiftRows.find((s) => s.code === 'evening') ?? shiftRows.find((s) => s.code === 'full_day');
  if (!morning || !evening) throw new Error('morning / evening shifts missing — run the base seed first.');

  let storeRows = await db
    .select({ id: stores.id, storeNo: stores.storeNo })
    .from(stores)
    .where(eq(stores.status, 'active'));
  if (ONLY) storeRows = storeRows.filter((s) => ONLY.includes(s.storeNo.toUpperCase()));
  storeRows.sort((a, b) => a.storeNo.localeCompare(b.storeNo, undefined, { numeric: true }));

  const staff = await db
    .select({ id: users.id, homeStoreId: users.homeStoreId, nik: users.nik })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.homeStoreId, storeRows.map((s) => s.id))));
  const staffByStore = new Map<number, string[]>();
  for (const u of staff) {
    if (u.homeStoreId == null || u.nik.includes('~deleted~')) continue;
    const list = staffByStore.get(u.homeStoreId) ?? [];
    list.push(u.id);
    staffByStore.set(u.homeStoreId, list);
  }

  // What is already there (either day encoding) — the sheet reads by Jakarta day.
  const rangeStart = jakartaMonthRange(MONTH).start;
  const rangeEnd = jakartaDayStart(addDaysKey(salesDays[salesDays.length - 1], 2));
  const [haveClosings, haveSetorans] = await Promise.all([
    db.select({ id: storeClosingTasks.id, storeId: storeClosingTasks.storeId, date: storeClosingTasks.date, photo: storeClosingTasks.eodEdcSettlementPhoto })
      .from(storeClosingTasks)
      .where(and(gte(storeClosingTasks.date, rangeStart), lt(storeClosingTasks.date, rangeEnd))),
    db.select({ id: setoranTasks.id, storeId: setoranTasks.storeId, date: setoranTasks.date, unpaid: setoranTasks.unpaidAmount, resi: setoranTasks.resiPhoto, cashier: setoranTasks.cashierPhoto })
      .from(setoranTasks)
      .where(and(gte(setoranTasks.date, rangeStart), lt(setoranTasks.date, rangeEnd))),
  ]);
  // Rows this script wrote earlier (placeholder photo) are rewritten on every run; anything else is
  // real or other seed data and stays unless --replace.
  const seededClosings = new Set(haveClosings.filter((c) => c.photo === PHOTO).map((c) => c.id));
  const seededSetorans = new Set(haveSetorans.filter((s) => s.resi === PHOTO || s.cashier === PHOTO).map((s) => s.id));
  const idsAt = (rows: { id: number; storeId: number; date: Date }[], storeId: number, day: string) =>
    rows.filter((r) => r.storeId === storeId && jakartaDateKey(r.date) === day).map((r) => r.id);
  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} · ${MONTH} · sales days ${salesDays[0]} … ${salesDays[salesDays.length - 1]} ` +
      `(${salesDays.length}) · ${storeRows.length} active stores`,
  );

  let closingsMade = 0, setoransMade = 0, skipped = 0, noStaff = 0;

  // Stores nobody is assigned to (staging only holds a handful of users) borrow existing
  // employee accounts as the "submitted by" — the columns are NOT NULL FKs, and creating
  // 40+ fake users would pollute IT Users.
  const fallbackCrew = (
    await db.select({ id: users.id, nik: users.nik }).from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt)))
  ).filter((u) => !u.nik.includes('~deleted~')).map((u) => u.id);
  if (fallbackCrew.length === 0) throw new Error('No active users at all — run the base seed first.');

  for (const store of storeRows) {
    const own = staffByStore.get(store.id);
    const crew = own?.length ? own : fallbackCrew;
    if (!own?.length) noStaff++;

    // Each store has its own size: ~Rp 8–60 jt a day, with a weekend bump.
    const size = 8_000_000 + rng(`size:${store.storeNo}`)() * 52_000_000;
    // Sisa still unpaid after the previous setoran we wrote.
    let carry = 0;

    for (const day of salesDays) {
      const r = rng(`${store.storeNo}:${day}`);
      const pick = () => crew[Math.floor(r() * crew.length)];
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      const total = size * (dow === 0 || dow === 6 ? 1.35 : 0.9 + r() * 0.3) * (0.85 + r() * 0.3);

      // Share of the day's sales per tender.
      const cash = total * (0.18 + r() * 0.17);
      const opMe = r() < 0.55 ? round(total * (0.01 + r() * 0.04), 1000) : null;
      const card = total - cash - (opMe ?? 0);
      const weights = EDC_BANKS.map((b) => (BANK_WEIGHT[b.code] ?? 1) * (0.6 + r() * 0.8));
      const wSum = weights.reduce((a, b) => a + b, 0);

      const cells: { bank: string; method: string; amount: number }[] = [];
      EDC_BANKS.forEach((b, i) => {
        const bankTotal = card * (weights[i] / wSum);
        if (b.code === 'indodana' ? r() < 0.55 : r() < 0.03) return; // some banks had no sales that day
        const qris = 0.3 + r() * 0.25;
        const debit = 0.3 + r() * 0.25;
        const credit = Math.max(0, 1 - qris - debit);
        for (const [method, share] of [['qris', qris], ['debit', debit], ['credit', credit]] as const) {
          const amount = round(bankTotal * share, 1000);
          if (amount > 0 && !(method === 'credit' && r() < 0.15)) cells.push({ bank: b.code, method, amount });
        }
      });

      const closingIds = idsAt(haveClosings, store.id, day);
      const hadClosing = closingIds.length > 0;
      const ownClosing = closingIds.every((id) => seededClosings.has(id));
      const onHold = r() < 0.03;
      const closeAt = new Date(jakartaDayStart(day).getTime() + (21 + r() * 1.5) * 3_600_000);
      const closeUser = pick();

      if (!hadClosing || ownClosing || REPLACE) {
        if (APPLY) {
          if (hadClosing) {
            // EDC rows go with their task (cascade).
            await db.delete(storeClosingTasks).where(inArray(storeClosingTasks.id, closingIds));
          }
          const hasIndodana = cells.some((c) => c.bank === 'indodana');
          const [task] = await db.insert(storeClosingTasks).values({
            userId: closeUser, storeId: store.id, shiftId: evening.id, date: jakartaDayStart(day),
            eodZReportDone: true, eodZReportBy: closeUser, eodZReportAt: closeAt,
            eodEdcSettlementPhoto: PHOTO, eodEdcSettlementPhotoBy: closeUser, eodEdcSettlementPhotoAt: closeAt,
            edcSettlementDone: true, edcSettlementBy: closeUser, edcSettlementAt: closeAt,
            edcSummaryDone: true, edcSummaryBy: closeUser, edcSummaryAt: closeAt,
            opMeVoucherAmount: opMe != null ? money(opMe) : null,
            indodanaDashboardPhoto: hasIndodana ? PHOTO : null,
            indodanaDashboardPhotoAt: hasIndodana ? closeAt : null,
            openStatementDecision: onHold ? 'on_hold' : 'post_statement',
            openStatementHoldReason: onHold ? 'Selisih EDC dengan Z-Report, menunggu pengecekan Ops.' : null,
            openStatementBy: closeUser, openStatementAt: closeAt,
            isOnHold: onHold, heldBy: onHold ? closeUser : null, heldAt: onHold ? closeAt : null,
            completedBy: onHold ? null : closeUser, completedAt: onHold ? null : closeAt,
            status: onHold ? 'in_progress' : 'completed',
            createdAt: closeAt, updatedAt: closeAt,
          }).returning({ id: storeClosingTasks.id });
          if (cells.length) {
            await db.insert(storeClosingEdcEntries).values(
              cells.map((c) => ({ taskId: task.id, bank: c.bank, method: c.method, amount: money(c.amount), createdAt: closeAt, updatedAt: closeAt })),
            );
          }
        }
        closingsMade++;
      } else skipped++;

      // The cash is counted the next morning and filed as D + 1's setoran.
      const setoranDay = addDaysKey(day, 1);
      const existing = idsAt(haveSetorans, store.id, setoranDay);
      if (existing.length > 0 && !REPLACE && !existing.every((id) => seededSetorans.has(id))) {
        // Keep the chain honest: what the real row left unpaid is what the next day carries.
        const real = haveSetorans.find((s) => s.id === existing[0]);
        carry = Math.round(Number(real?.unpaid ?? 0));
        skipped++;
        continue;
      }

      const received = round(cash, 1000);
      const required = received + carry;
      // Cash goes to the bank in notes of Rp 50.000 only: Setoran Tunai is a multiple of 50k,
      // and whatever is left is Sisa — always under Rp 50.000.
      const stored = Math.floor(required / SETORAN_STEP) * SETORAN_STEP;
      const unpaid = required - stored;
      const small = stored === 0; // < Rp 50.000 in the drawer = setoran kecil: nothing deposited
      const noSetoran = received === 0 && stored === 0;
      const setUser = pick();
      const setAt = new Date(jakartaDayStart(setoranDay).getTime() + (9 + r() * 2) * 3_600_000);

      if (APPLY) {
        if (existing.length > 0) {
          await db.delete(setoranMoneyStorage).where(inArray(setoranMoneyStorage.taskId, existing));
          await db.delete(setoranTasks).where(inArray(setoranTasks.id, existing));
        }
        const photos = small
          ? { cashierPhoto: PHOTO, atmCardPhoto: PHOTO }
          : { resiPhoto: PHOTO, atmCardSelfiePhoto: PHOTO };
        const note = unpaid > 0 ? 'Sisa (di bawah Rp 50.000) disimpan di toko.' : null;
        const [task] = await db.insert(setoranTasks).values({
          userId: setUser, storeId: store.id, shiftId: morning.id, date: jakartaDayStart(setoranDay),
          expectedAmount: money(received), carriedDeficit: money(carry), amount: money(stored), unpaidAmount: money(unpaid),
          isNoSetoran: noSetoran, notes: note, ...photos,
          completedBy: setUser, status: 'completed', completedAt: setAt, createdAt: setAt, updatedAt: setAt,
        }).returning({ id: setoranTasks.id });
        await db.insert(setoranMoneyStorage).values({
          taskId: task.id, userId: setUser, storeId: store.id, shiftId: morning.id, date: jakartaDayStart(setoranDay),
          actualReceivedAmount: money(received), previousUnpaidAmount: money(carry), requiredStoreAmount: money(required),
          storedAmount: money(stored), unpaidAmount: money(unpaid), isNoSetoran: noSetoran, notes: note, ...photos,
          completedBy: setUser, createdAt: setAt, updatedAt: setAt,
        });
      }
      carry = unpaid;
      setoransMade++;
    }
  }

  console.log(
    `${APPLY ? 'Created' : 'Would create'} ${closingsMade} store closings + ${setoransMade} setorans; ` +
      `${skipped} store-days already had rows; ${noStaff} stores had no staff of their own (borrowed accounts).`,
  );
  if (!APPLY) console.log('Dry run — add --apply to write.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
