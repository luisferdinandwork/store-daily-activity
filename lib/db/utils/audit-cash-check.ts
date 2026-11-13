// lib/db/utils/audit-cash-check.ts
//
// Audit "Pemeriksaan Kas" — the DB side (rules, shapes and totals: lib/audit-cash-check.ts; table:
// lib/db/schema/audit-cash-checks.ts). One row per store per Jakarta day, filled by Cek Modal and Cek Petty Cash,
// printed by the Berita Acara.
//
// THE PETTY CASH CHECKLIST = the completed requests Finance ("FA") has not covered with a verified Refill yet, of
// the period in use and the period before it (never older). For each of those two periods:
//   - its Refill is not verified by Finance (not asked for, waiting on OPS / Finance, or rejected) → every request
//     of the period that counts as used is listed;
//   - its Refill is verified → only what was booked AFTER Finance verified it is listed (the transfer did not cover
//     it; it carries into the next refill), and if the store has not received that Refill yet its frozen amount is
//     the Berita Acara's "Penggantian petty cash periode lalu yang belum diterima";
//   - Finance settled it itself at month end (legacy `petty_cash_refills`) → nothing.
// Requests Finance left out (Perlu Perbaikan / Ditolak) are not "used" (PIC 1 pays them back), so they are never
// listed. With every line ticked, "Sisa petty cash menurut buku" equals what PRISM says the box holds (getSpendable).

import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  auditCashChecks,
  cekUangModalTasks,
  employeeTypes,
  pettyCashRefillRequests,
  pettyCashRefills,
  pettyCashTransactions,
  stores,
  userRoles,
  users,
  type AuditCashCheck,
} from '@/lib/db/schema';
import { jakartaDateKey, jakartaDayRange, jakartaTodayKey } from '@/lib/day-bucket';
import { pettyCashDescription } from '@/lib/petty-cash-categories';
import { addMonths, periodRangeLabel } from '@/lib/petty-cash-period';
import {
  DEFAULT_APPROVED,
  DEFAULT_AUDITOR_CAPTION,
  DEFAULT_KNOWN,
  DEFAULT_SIGN_CITY,
  DOC_NUMBER_MAX,
  NOTES_MAX,
  PETTY_CASH_FUND,
  PETTY_EXTRA_DESCRIPTION_MAX,
  PETTY_EXTRA_MAX,
  PETTY_ITEM_NOTE_MAX,
  SIGNATORY_MAX,
  UANG_MODAL_MAX_TOTAL,
  buildDocNumber,
  cashCheckTotals,
  holderCaptionFor,
  isDay,
  normalizeCounts,
  toMoney,
  type CashCheckListRow,
  type CashCheckRecord,
  type DenominationCounts,
  type PeriodRefillState,
  type PettyCheckItem,
  type PettyExtraItem,
} from '@/lib/audit-cash-check';
import { countsAsUsed } from './petty-cash-used';
import { getActivePeriod } from './petty-cash-period';
import { getSpendable } from './petty-cash-refill';

type Result<T> = { success: true; data: T } | { success: false; error: string; status?: number };

const fail = (error: string, status = 400): { success: false; error: string; status: number } => ({
  success: false,
  error,
  status,
});

// ─── Stores + staff ──────────────────────────────────────────────────────────

export interface AuditStoreOption {
  id: number;
  storeNo: string;
  name: string;
}

/** Stores the audit team can count: the active ones. */
export async function listAuditStores(): Promise<AuditStoreOption[]> {
  return db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.status, 'active'))
    .orderBy(stores.storeNo);
}

export interface StaffOption {
  id: string;
  name: string;
  nik: string;
  typeCode: string | null;
  typeLabel: string | null;
}

export interface StoreContext {
  store: { id: number; storeNo: string; name: string; status: string };
  staff: StaffOption[];
  /** The store's PIC 1 (the petty cash holder) — the default Pemegang Kas. */
  defaultHolderId: string | null;
}

const TYPE_ORDER: Record<string, number> = { pic_1: 0, pic_2: 1, sa: 2 };

export async function getStoreContext(storeId: number): Promise<StoreContext | null> {
  const [store] = await db
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      nik: users.nik,
      typeCode: employeeTypes.code,
      typeLabel: employeeTypes.label,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(
      and(
        eq(users.homeStoreId, storeId),
        eq(users.isActive, true),
        isNull(users.deletedAt),
        eq(userRoles.code, 'employee'),
      ),
    );

  const staff = rows.sort(
    (a, b) =>
      (TYPE_ORDER[a.typeCode ?? ''] ?? 9) - (TYPE_ORDER[b.typeCode ?? ''] ?? 9) || a.name.localeCompare(b.name, 'id'),
  );
  const pic1 = staff.find((s) => s.typeCode === 'pic_1') ?? null;
  return { store: { ...store, status: String(store.status) }, staff, defaultHolderId: pic1?.id ?? null };
}

// ─── Row ↔ record ────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

async function nameOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? null;
}

async function toRecord(row: AuditCashCheck): Promise<CashCheckRecord> {
  const [store] = await db
    .select({ storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.id, row.storeId))
    .limit(1);
  const [modalBy, pettyBy] = await Promise.all([nameOf(row.modalCheckedBy), nameOf(row.pettyCheckedBy)]);

  return {
    id: row.id,
    storeId: row.storeId,
    storeNo: store?.storeNo ?? '',
    storeName: store?.name ?? '',
    checkDate: row.checkDate,
    docNumber: row.docNumber,
    signCity: row.signCity,
    signDate: row.signDate,
    holderUserId: row.holderUserId,
    holderName: row.holderName,
    holderCaption: row.holderCaption,
    auditorName: row.auditorName,
    auditorCaption: row.auditorCaption,
    known: { name: row.knownName, title: row.knownTitle },
    approved: { name: row.approvedName, title: row.approvedTitle },

    modalBook: row.modalBook,
    salesCash: row.salesCash,
    salesDebit: row.salesDebit,
    salesCredit: row.salesCredit,
    salesVoucher: row.salesVoucher,
    modalCounts: normalizeCounts(row.modalCounts),
    modalNotes: row.modalNotes,
    modalCheckedAt: iso(row.modalCheckedAt),
    modalCheckedBy: modalBy,

    pettyFund: row.pettyFund,
    pettyItems: Array.isArray(row.pettyItems) ? row.pettyItems : [],
    pettyExtras: Array.isArray(row.pettyExtras) ? row.pettyExtras : [],
    pettyPendingRefill: row.pettyPendingRefill,
    pettyCounts: normalizeCounts(row.pettyCounts),
    pettyNotes: row.pettyNotes,
    pettySystemBalance: row.pettySystemBalance,
    pettyCheckedAt: iso(row.pettyCheckedAt),
    pettyCheckedBy: pettyBy,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findRow(storeId: number, day: string): Promise<AuditCashCheck | null> {
  const [row] = await db
    .select()
    .from(auditCashChecks)
    .where(and(eq(auditCashChecks.storeId, storeId), eq(auditCashChecks.checkDate, day)))
    .limit(1);
  return row ?? null;
}

export async function getCashCheck(storeId: number, day: string): Promise<CashCheckRecord | null> {
  const row = await findRow(storeId, day);
  return row ? toRecord(row) : null;
}

export async function getCashCheckById(id: number): Promise<CashCheckRecord | null> {
  const [row] = await db.select().from(auditCashChecks).where(eq(auditCashChecks.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

// ─── Creating the row (first save of either half) ────────────────────────────

/** What a new Berita Acara starts with: the next number of the year, and the signatories the team used last. */
async function ensureRow(
  storeId: number,
  storeNo: string,
  day: string,
  actorId: string,
  holder: { id: string | null; name: string },
): Promise<AuditCashCheck> {
  const existing = await findRow(storeId, day);
  if (existing) return existing;

  const year = Number(day.slice(0, 4));
  const [{ maxSeq }] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${auditCashChecks.docSeq}), 0)` })
    .from(auditCashChecks)
    .where(sql`EXTRACT(YEAR FROM ${auditCashChecks.checkDate}) = ${year}`);
  const seq = Number(maxSeq) + 1;

  const [last] = await db
    .select({
      signCity: auditCashChecks.signCity,
      knownName: auditCashChecks.knownName,
      knownTitle: auditCashChecks.knownTitle,
      approvedName: auditCashChecks.approvedName,
      approvedTitle: auditCashChecks.approvedTitle,
    })
    .from(auditCashChecks)
    .orderBy(desc(auditCashChecks.updatedAt))
    .limit(1);

  const auditorName = (await nameOf(actorId)) ?? '';
  const now = new Date();

  await db
    .insert(auditCashChecks)
    .values({
      storeId,
      checkDate: day,
      docSeq: seq,
      docNumber: buildDocNumber(seq, storeNo, day),
      signCity: last?.signCity || DEFAULT_SIGN_CITY,
      signDate: day,
      holderUserId: holder.id,
      holderName: holder.name,
      holderCaption: holderCaptionFor(storeNo),
      auditorUserId: actorId,
      auditorName,
      auditorCaption: DEFAULT_AUDITOR_CAPTION,
      knownName: last?.knownName || DEFAULT_KNOWN.name,
      knownTitle: last?.knownTitle || DEFAULT_KNOWN.title,
      approvedName: last?.approvedName || DEFAULT_APPROVED.name,
      approvedTitle: last?.approvedTitle || DEFAULT_APPROVED.title,
      modalBook: UANG_MODAL_MAX_TOTAL,
      pettyFund: PETTY_CASH_FUND,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [auditCashChecks.storeId, auditCashChecks.checkDate] });

  const row = await findRow(storeId, day);
  if (!row) throw new Error('Berita Acara could not be created.');
  return row;
}

/** Resolves the Pemegang Kas a save names: a staff member of the store, else the row's / the store's default. */
async function resolveHolder(
  ctx: StoreContext,
  holderUserId: unknown,
): Promise<{ id: string | null; name: string } | null> {
  if (typeof holderUserId !== 'string' || !holderUserId) return null;
  const staff = ctx.staff.find((s) => s.id === holderUserId);
  if (staff) return { id: staff.id, name: staff.name };
  const name = await nameOf(holderUserId);
  return name ? { id: holderUserId, name } : null;
}

function defaultHolder(ctx: StoreContext): { id: string | null; name: string } {
  const pic1 = ctx.staff.find((s) => s.id === ctx.defaultHolderId);
  return pic1 ? { id: pic1.id, name: pic1.name } : { id: null, name: '' };
}

function checkDay(day: unknown): string | null {
  if (!isDay(day)) return 'Tanggal pemeriksaan tidak valid.';
  if (day > jakartaTodayKey()) return 'Tanggal pemeriksaan tidak boleh di masa depan.';
  return null;
}

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

// ─── Cek Modal ───────────────────────────────────────────────────────────────

export interface ModalModelReference {
  /** What the store's staff counted in today's Cek Uang Modal task (latest completed), for comparison. */
  total: number;
  by: string | null;
  at: string | null;
}

export async function getModalReference(storeId: number, day: string): Promise<ModalModelReference | null> {
  const { start, end } = jakartaDayRange(day);
  const [row] = await db
    .select({
      total: cekUangModalTasks.totalAmount,
      by: users.name,
      at: cekUangModalTasks.completedAt,
    })
    .from(cekUangModalTasks)
    .leftJoin(users, eq(users.id, cekUangModalTasks.userId))
    .where(
      and(
        eq(cekUangModalTasks.storeId, storeId),
        gte(cekUangModalTasks.date, start),
        lt(cekUangModalTasks.date, end),
        eq(cekUangModalTasks.status, 'completed'),
      ),
    )
    .orderBy(desc(cekUangModalTasks.completedAt))
    .limit(1);
  if (!row) return null;
  return { total: Math.round(Number(row.total ?? 0)), by: row.by ?? null, at: iso(row.at) };
}

export interface ModalSaveInput {
  storeId: number;
  date: string;
  holderUserId?: string | null;
  modalBook: unknown;
  salesCash: unknown;
  salesDebit: unknown;
  salesCredit: unknown;
  salesVoucher: unknown;
  counts: unknown;
  notes?: unknown;
}

export async function saveModalCheck(actorId: string, input: ModalSaveInput): Promise<Result<CashCheckRecord>> {
  const dayProblem = checkDay(input.date);
  if (dayProblem) return fail(dayProblem);
  const ctx = await getStoreContext(input.storeId);
  if (!ctx) return fail('Toko tidak ditemukan.', 404);

  const counts: DenominationCounts = normalizeCounts(input.counts);
  const chosen = await resolveHolder(ctx, input.holderUserId);
  const row = await ensureRow(ctx.store.id, ctx.store.storeNo, input.date, actorId, chosen ?? defaultHolder(ctx));
  const now = new Date();

  await db
    .update(auditCashChecks)
    .set({
      ...(chosen ? { holderUserId: chosen.id, holderName: chosen.name } : {}),
      modalBook: toMoney(input.modalBook),
      salesCash: toMoney(input.salesCash),
      salesDebit: toMoney(input.salesDebit),
      salesCredit: toMoney(input.salesCredit),
      salesVoucher: toMoney(input.salesVoucher),
      modalCounts: counts,
      modalNotes: cleanText(input.notes, NOTES_MAX),
      modalCheckedAt: now,
      modalCheckedBy: actorId,
      updatedAt: now,
    })
    .where(eq(auditCashChecks.id, row.id));

  const saved = await getCashCheckById(row.id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}

// ─── Cek Petty Cash ──────────────────────────────────────────────────────────

export interface PettyPeriodGroup {
  month: string;
  rangeLabel: string;
  refillState: PeriodRefillState;
  /** When Finance verified this period's refill (only lines booked after it are listed). */
  verifiedAt: string | null;
  /** The frozen refill not received yet, when `refillState` is 'verified'. */
  pendingRefill: number;
  items: PettyCheckItem[];
}

export interface PettyInProgress {
  txId: number;
  date: string;
  category: string | null;
  description: string;
  amount: number;
}

export interface PettyCandidates {
  /** False for a store that is not active (no petty cash to check). */
  available: boolean;
  usageMonth: string | null;
  periods: PettyPeriodGroup[];
  /** Σ refills Finance verified that the store has not received — the "Penggantian … belum diterima" default. */
  pendingRefill: number;
  /** What PRISM says the box holds now (getSpendable). */
  systemBalance: number | null;
  /** Approved by OPS, actual amount not recorded yet — the cash may already be out of the box. */
  inProgress: PettyInProgress[];
}

function refillStateOf(r: {
  status: string;
  financeVerifiedAt: Date | null;
  balanceAfter: string | null;
}): PeriodRefillState {
  if (r.status === 'pending') return 'waiting_ops';
  if (r.status === 'rejected') return 'rejected';
  if (r.balanceAfter != null) return 'received';
  if (r.financeVerifiedAt) return 'verified';
  return 'waiting_finance';
}

/** The live checklist for a store, as of Jakarta day `day` (lines filed after it are left out). */
export async function getPettyCandidates(storeId: number, day: string): Promise<PettyCandidates> {
  const empty: PettyCandidates = {
    available: false,
    usageMonth: null,
    periods: [],
    pendingRefill: 0,
    systemBalance: null,
    inProgress: [],
  };
  const [store] = await db.select({ status: stores.status }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store || store.status !== 'active') return empty;

  const usage = await getActivePeriod(storeId);
  const months = [addMonths(usage.yearMonth, -1), usage.yearMonth];
  const dayEnd = jakartaDayRange(day).end;

  const [refills, legacy, txs, spendable, approved] = await Promise.all([
    db
      .select({
        yearMonth: pettyCashRefillRequests.yearMonth,
        status: pettyCashRefillRequests.status,
        financeVerifiedAt: pettyCashRefillRequests.financeVerifiedAt,
        balanceAfter: pettyCashRefillRequests.balanceAfter,
        transferAmount: pettyCashRefillRequests.transferAmount,
        requestedAt: pettyCashRefillRequests.requestedAt,
      })
      .from(pettyCashRefillRequests)
      .where(and(eq(pettyCashRefillRequests.storeId, storeId), inArray(pettyCashRefillRequests.yearMonth, months)))
      .orderBy(desc(pettyCashRefillRequests.requestedAt), desc(pettyCashRefillRequests.id)),
    db
      .select({ yearMonth: pettyCashRefills.yearMonth })
      .from(pettyCashRefills)
      .where(and(eq(pettyCashRefills.storeId, storeId), inArray(pettyCashRefills.yearMonth, months))),
    db
      .select({
        id: pettyCashTransactions.id,
        yearMonth: pettyCashTransactions.yearMonth,
        description: pettyCashTransactions.description,
        categoryName: pettyCashTransactions.categoryName,
        amount: pettyCashTransactions.amount,
        actualAmount: pettyCashTransactions.actualAmount,
        actualAmountAt: pettyCashTransactions.actualAmountAt,
        imageUrl: pettyCashTransactions.imageUrl,
        isReRequest: pettyCashTransactions.isReRequest,
        requestDate: pettyCashTransactions.requestDate,
        createdAt: pettyCashTransactions.createdAt,
        requestedBy: users.name,
      })
      .from(pettyCashTransactions)
      .leftJoin(users, eq(users.id, pettyCashTransactions.userId))
      .where(
        and(
          eq(pettyCashTransactions.storeId, storeId),
          eq(pettyCashTransactions.status, 'completed'),
          inArray(pettyCashTransactions.yearMonth, months),
          countsAsUsed(pettyCashTransactions.financeReview),
          lt(pettyCashTransactions.createdAt, dayEnd),
        ),
      )
      .orderBy(pettyCashTransactions.createdAt, pettyCashTransactions.id),
    getSpendable(storeId, usage),
    db
      .select({
        id: pettyCashTransactions.id,
        description: pettyCashTransactions.description,
        categoryName: pettyCashTransactions.categoryName,
        amount: pettyCashTransactions.amount,
        createdAt: pettyCashTransactions.createdAt,
      })
      .from(pettyCashTransactions)
      .where(
        and(
          eq(pettyCashTransactions.storeId, storeId),
          eq(pettyCashTransactions.status, 'ops_approved'),
          lt(pettyCashTransactions.createdAt, dayEnd),
        ),
      )
      .orderBy(pettyCashTransactions.createdAt),
  ]);

  const legacyMonths = new Set(legacy.map((l) => l.yearMonth));
  let pendingRefill = 0;

  const periods: PettyPeriodGroup[] = months.map((month) => {
    const latest = refills.find((r) => r.yearMonth === month) ?? null;
    const state: PeriodRefillState = legacyMonths.has(month) ? 'received' : latest ? refillStateOf(latest) : 'none';
    const coveredAt =
      legacyMonths.has(month) ? null : state === 'verified' || state === 'received' ? latest?.financeVerifiedAt ?? null : null;
    const groupPending = state === 'verified' ? Math.max(0, Math.round(Number(latest?.transferAmount ?? 0))) : 0;
    pendingRefill += groupPending;

    const items: PettyCheckItem[] = legacyMonths.has(month)
      ? []
      : txs
          .filter((t) => t.yearMonth === month)
          .filter((t) => {
            if (!coveredAt) return true;
            const bookedAt = t.actualAmountAt ?? t.createdAt;
            return bookedAt.getTime() > coveredAt.getTime();
          })
          .map((t) => ({
            txId: t.id,
            date: jakartaDateKey(t.isReRequest && t.requestDate ? t.requestDate : t.createdAt),
            periodMonth: month,
            category: t.categoryName,
            description: pettyCashDescription(t.description),
            amount: Math.round(Number(t.actualAmount ?? t.amount)),
            imageUrl: t.imageUrl,
            isReRequest: t.isReRequest,
            requestedBy: t.requestedBy ?? null,
            checked: false,
            note: null,
          }));

    return {
      month,
      rangeLabel: periodRangeLabel(month),
      refillState: state,
      verifiedAt: iso(coveredAt),
      pendingRefill: groupPending,
      items,
    };
  });

  return {
    available: true,
    usageMonth: usage.yearMonth,
    periods,
    pendingRefill,
    systemBalance: spendable.spendable,
    inProgress: approved.map((t) => ({
      txId: t.id,
      date: jakartaDateKey(t.createdAt),
      category: t.categoryName,
      description: pettyCashDescription(t.description),
      amount: Math.round(Number(t.amount)),
    })),
  };
}

/**
 * The checklist the auditor sees: today's live lines merged with what was saved before (a saved line that Finance
 * has covered since stays, as saved — the Berita Acara must not change under the auditor), ticks + notes from the
 * saved snapshot.
 */
export function mergeChecklist(live: PettyCheckItem[], saved: PettyCheckItem[]): PettyCheckItem[] {
  const savedById = new Map(saved.map((s) => [s.txId, s]));
  const liveIds = new Set(live.map((l) => l.txId));
  const merged = live.map((l) => {
    const s = savedById.get(l.txId);
    return s ? { ...l, checked: s.checked, note: s.note } : l;
  });
  for (const s of saved) if (!liveIds.has(s.txId)) merged.push(s);
  return merged.sort((a, b) => a.date.localeCompare(b.date) || a.txId - b.txId);
}

export interface PettySaveInput {
  storeId: number;
  date: string;
  holderUserId?: string | null;
  /** The auditor's ticks + notes, by request id. Amounts and texts always come from the server. */
  items: unknown;
  extras: unknown;
  pendingRefill: unknown;
  counts: unknown;
  notes?: unknown;
}

function cleanExtras(input: unknown): PettyExtraItem[] | string {
  if (!Array.isArray(input)) return [];
  if (input.length > PETTY_EXTRA_MAX) return `Maksimal ${PETTY_EXTRA_MAX} pengeluaran lain.`;
  const out: PettyExtraItem[] = [];
  for (const [i, raw] of input.entries()) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const description = cleanText(e.description, PETTY_EXTRA_DESCRIPTION_MAX);
    if (!description) return `Keperluan pengeluaran lain #${i + 1} wajib diisi.`;
    if (!isDay(e.date)) return `Tanggal pengeluaran lain #${i + 1} tidak valid.`;
    const qty = Math.floor(Number(e.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 9_999) return `Qty pengeluaran lain #${i + 1} tidak valid.`;
    const price = toMoney(e.price);
    if (price <= 0) return `Harga pengeluaran lain #${i + 1} wajib diisi.`;
    out.push({
      key: typeof e.key === 'string' && e.key ? e.key.slice(0, 40) : `x${i}`,
      date: e.date as string,
      description: description.toLocaleUpperCase('id-ID'),
      qty,
      price,
    });
  }
  return out;
}

export async function savePettyCheck(actorId: string, input: PettySaveInput): Promise<Result<CashCheckRecord>> {
  const dayProblem = checkDay(input.date);
  if (dayProblem) return fail(dayProblem);
  const ctx = await getStoreContext(input.storeId);
  if (!ctx) return fail('Toko tidak ditemukan.', 404);

  const extras = cleanExtras(input.extras);
  if (typeof extras === 'string') return fail(extras);

  const ticks = new Map<number, { checked: boolean; note: string | null }>();
  if (Array.isArray(input.items)) {
    for (const raw of input.items) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const id = Number(r.txId);
      if (Number.isInteger(id)) ticks.set(id, { checked: r.checked === true, note: cleanText(r.note, PETTY_ITEM_NOTE_MAX) });
    }
  }

  const chosen = await resolveHolder(ctx, input.holderUserId);
  const row = await ensureRow(ctx.store.id, ctx.store.storeNo, input.date, actorId, chosen ?? defaultHolder(ctx));
  const candidates = await getPettyCandidates(ctx.store.id, input.date);
  const live = candidates.periods.flatMap((p) => p.items);
  const items = mergeChecklist(live, Array.isArray(row.pettyItems) ? row.pettyItems : []).map((item) => {
    const t = ticks.get(item.txId);
    return t ? { ...item, checked: t.checked, note: t.note } : item;
  });
  const now = new Date();

  await db
    .update(auditCashChecks)
    .set({
      ...(chosen ? { holderUserId: chosen.id, holderName: chosen.name } : {}),
      pettyFund: PETTY_CASH_FUND,
      pettyItems: items,
      pettyExtras: extras,
      pettyPendingRefill: toMoney(input.pendingRefill),
      pettyCounts: normalizeCounts(input.counts),
      pettyNotes: cleanText(input.notes, NOTES_MAX),
      pettySystemBalance: candidates.systemBalance,
      pettyCheckedAt: now,
      pettyCheckedBy: actorId,
      updatedAt: now,
    })
    .where(eq(auditCashChecks.id, row.id));

  const saved = await getCashCheckById(row.id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}

// ─── Berita Acara: header, list, delete ──────────────────────────────────────

/** The printed header + signature texts the auditor can change on the Berita Acara page. */
const HEADER_FIELDS = [
  ['docNumber', DOC_NUMBER_MAX, 'Nomor dokumen'],
  ['signCity', SIGNATORY_MAX, 'Kota'],
  ['holderName', SIGNATORY_MAX, null],
  ['holderCaption', SIGNATORY_MAX, null],
  ['auditorName', SIGNATORY_MAX, null],
  ['auditorCaption', SIGNATORY_MAX, null],
  ['knownName', SIGNATORY_MAX, null],
  ['knownTitle', SIGNATORY_MAX, null],
  ['approvedName', SIGNATORY_MAX, null],
  ['approvedTitle', SIGNATORY_MAX, null],
] as const satisfies ReadonlyArray<readonly [keyof typeof auditCashChecks.$inferInsert, number, string | null]>;

export async function updateHeader(id: number, input: Record<string, unknown>): Promise<Result<CashCheckRecord>> {
  const [row] = await db.select({ id: auditCashChecks.id }).from(auditCashChecks).where(eq(auditCashChecks.id, id)).limit(1);
  if (!row) return fail('Berita Acara tidak ditemukan.', 404);

  const patch: Partial<typeof auditCashChecks.$inferInsert> = {};
  for (const [key, max, requiredLabel] of HEADER_FIELDS) {
    if (!(key in input)) continue;
    const value = typeof input[key] === 'string' ? (input[key] as string).trim().slice(0, max) : '';
    if (requiredLabel && !value) return fail(`${requiredLabel} wajib diisi.`);
    patch[key] = value;
  }
  if ('signDate' in input) {
    if (!isDay(input.signDate)) return fail('Tanggal tanda tangan tidak valid.');
    patch.signDate = input.signDate;
  }
  if (Object.keys(patch).length === 0) return fail('Tidak ada yang diubah.');

  await db
    .update(auditCashChecks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(auditCashChecks.id, id));
  const saved = await getCashCheckById(id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}

export async function deleteCashCheck(id: number): Promise<Result<{ id: number }>> {
  const deleted = await db.delete(auditCashChecks).where(eq(auditCashChecks.id, id)).returning({ id: auditCashChecks.id });
  return deleted.length ? { success: true, data: { id } } : fail('Berita Acara tidak ditemukan.', 404);
}

/** Every Berita Acara of a month (by check date), newest first. */
export async function listCashChecks(month: string): Promise<CashCheckListRow[]> {
  const from = `${month}-01`;
  const to = `${addMonths(month, 1)}-01`;
  const rows = await db
    .select({ row: auditCashChecks, storeNo: stores.storeNo, storeName: stores.name })
    .from(auditCashChecks)
    .innerJoin(stores, eq(stores.id, auditCashChecks.storeId))
    .where(and(gte(auditCashChecks.checkDate, from), lt(auditCashChecks.checkDate, to)))
    .orderBy(desc(auditCashChecks.checkDate), stores.storeNo);

  return rows.map(({ row, storeNo, storeName }) => {
    const totals = cashCheckTotals({
      ...row,
      modalCounts: normalizeCounts(row.modalCounts),
      pettyCounts: normalizeCounts(row.pettyCounts),
      pettyItems: Array.isArray(row.pettyItems) ? row.pettyItems : [],
      pettyExtras: Array.isArray(row.pettyExtras) ? row.pettyExtras : [],
    });
    const modalDone = row.modalCheckedAt != null;
    const pettyDone = row.pettyCheckedAt != null;
    return {
      id: row.id,
      storeId: row.storeId,
      storeNo,
      storeName,
      checkDate: row.checkDate,
      docNumber: row.docNumber,
      holderName: row.holderName,
      auditorName: row.auditorName,
      modalDone,
      pettyDone,
      modalDiff: modalDone ? totals.modalDiff : null,
      pettyDiff: pettyDone ? totals.pettyDiff : null,
      finalDiff: (modalDone ? totals.modalDiff : 0) + (pettyDone ? totals.pettyDiff : 0),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}
