// lib/db/utils/audit-stock-opname.ts
//
// Audit "Stock Opname" — the DB side (rules, shapes, totals: lib/audit-stock-opname.ts; table:
// lib/db/schema/audit-stock-opnames.ts). One row per store per Jakarta day, filled on /audit/stock-opname and
// printed as the Berita Acara Stock Opname + the Surat Pernyataan Hasil SO Store.
//
// Business Central gives the starting numbers (getSoBcSnapshot): the day's Cek Bin lines of the store (Σ qty in bin,
// Σ scanned, bins right / wrong, per-SKU differences — priced once BC sends a price), the bins that hold stock now,
// and the day's POS sales. The auditor confirms or changes each number; the save stores them + the BC snapshot.

import { and, desc, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { auditStockOpnames, storeVisitPolicies, stores, users, type AuditStockOpname } from '@/lib/db/schema';
import { addDaysKey, jakartaTodayKey } from '@/lib/day-bucket';
import { addMonths } from '@/lib/petty-cash-period';
import { getBinCheckDayHeaders, getStoreBinContents } from '@/lib/bc/bin-check-audit';
import { getBusinessCentralSalesEntries } from '@/lib/performance/business-central-sales';
import {
  DEFAULT_APPROVED,
  DEFAULT_AUDITOR_CAPTION,
  DEFAULT_HOLDER_TITLE,
  DEFAULT_KNOWN,
  DEFAULT_SIGN_CITY,
  SO_NOTES_MAX,
  SO_TEXT_MAX,
  brandOfStore,
  cleanFindings,
  defaultStoreTitle,
  holderCaptionForSo,
  isSoBrandKey,
  isSoDate,
  locationOfStore,
  soTotals,
  summarizeSoLines,
  titleCase,
  toQty,
  toValue,
  type SoBcSnapshot,
  type SoBrandKey,
  type SoValueSource,
  type StockOpnameListRow,
  type StockOpnameRecord,
} from '@/lib/audit-stock-opname';
import { DOC_NUMBER_MAX } from '@/lib/audit-cash-check';
import { DEFAULT_IR, cleanRewardRows } from '@/lib/audit-super-reward';
import { getStoreContext, type StoreContext } from './audit-cash-check';
import { newAuditDocNumber } from './audit-doc-number';
import { getHiddenStores, isStoreHidden, notHiddenStore } from '@/lib/db/utils/it-only-stores';

type Result<T> = { success: true; data: T } | { success: false; error: string; status?: number };

const fail = (error: string, status = 400): { success: false; error: string; status: number } => ({ success: false, error, status });

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ─── Business Central ────────────────────────────────────────────────────────

/**
 * POS pieces sold that day (net of returns). LS sales lines carry quantity −1 per piece sold and +1 per return, so
 * the day's net is |Σ quantity| — taken as an absolute so a feed that sends sales as positive works the same.
 */
async function salesPieces(storeNo: string, day: string): Promise<number | null> {
  try {
    const rows = await getBusinessCentralSalesEntries({ storeNo, startDate: day, endDate: addDaysKey(day, 1) });
    const sum = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    return Math.round(Math.abs(sum));
  } catch {
    return null;
  }
}

/** What BC says for the store + day now. Never throws. */
export async function getSoBcSnapshot(storeNo: string, day: string, force = false): Promise<SoBcSnapshot> {
  const [lines, contents, sales] = await Promise.all([
    getBinCheckDayHeaders({ location: storeNo, day, force }),
    getStoreBinContents({ location: storeNo, force }),
    salesPieces(storeNo, day),
  ]);
  return {
    state: lines.state,
    fetchedAt: lines.fetchedAt ?? new Date().toISOString(),
    ...summarizeSoLines(lines.headers, storeNo, day),
    storeBinsState: contents.state,
    storeBins: contents.bins,
    storeQty: contents.quantity,
    salesQty: sales,
  };
}

// ─── Store defaults ──────────────────────────────────────────────────────────

/** The store's city as Ops keeps it on the Visit Toko rules ("MEDAN" → "Medan"); '' when unknown. */
async function storeCity(storeNo: string): Promise<string> {
  const [row] = await db
    .select({ city: storeVisitPolicies.city })
    .from(storeVisitPolicies)
    .where(eq(storeVisitPolicies.storeNo, storeNo))
    .limit(1);
  return row?.city ? titleCase(row.city.trim()) : '';
}

export interface SoStoreDefaults {
  storeTitle: string;
  suratCity: string;
  suratBrand: SoBrandKey;
  suratLocation: string;
  holderCaption: string;
}

export async function getSoStoreDefaults(store: { storeNo: string; name: string }): Promise<SoStoreDefaults> {
  return {
    storeTitle: defaultStoreTitle(store.name),
    suratCity: (await storeCity(store.storeNo)) || DEFAULT_SIGN_CITY,
    suratBrand: brandOfStore(store.storeNo),
    suratLocation: locationOfStore(store.name),
    holderCaption: holderCaptionForSo(store.storeNo),
  };
}

// ─── Row ↔ record ────────────────────────────────────────────────────────────

async function nameOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? null;
}

async function toRecord(row: AuditStockOpname): Promise<StockOpnameRecord> {
  const [store] = await db.select({ storeNo: stores.storeNo, name: stores.name }).from(stores).where(eq(stores.id, row.storeId)).limit(1);
  return {
    id: row.id,
    storeId: row.storeId,
    storeNo: store?.storeNo ?? '',
    storeName: store?.name ?? '',
    soDate: row.soDate,
    docNumber: row.docNumber,
    signCity: row.signCity,
    signDate: row.signDate,
    storeTitle: row.storeTitle,
    sohBc: row.sohBc,
    scanQty: row.scanQty,
    shoppingBagQty: row.shoppingBagQty,
    transSalesQty: row.transSalesQty,
    valuePlus: row.valuePlus,
    valueMinus: row.valueMinus,
    valueSource: row.valueSource === 'bc' || row.valueSource === 'manual' ? row.valueSource : null,
    binsTotal: row.binsTotal,
    binsMatch: row.binsMatch,
    binsMismatch: row.binsMismatch,
    findings: Array.isArray(row.findings) ? row.findings.filter((f): f is string => typeof f === 'string') : [],
    bcSnapshot: row.bcSnapshot ?? null,
    suratCity: row.suratCity,
    suratBrand: isSoBrandKey(row.suratBrand) ? row.suratBrand : '',
    suratLocation: row.suratLocation,
    holderUserId: row.holderUserId,
    holderName: row.holderName,
    holderCaption: row.holderCaption,
    holderTitle: row.holderTitle,
    auditorName: row.auditorName,
    auditorCaption: row.auditorCaption,
    known: { name: row.knownName, title: row.knownTitle },
    approved: { name: row.approvedName, title: row.approvedTitle },
    ir: { name: row.irName || DEFAULT_IR.name, title: row.irTitle || DEFAULT_IR.title },
    reward: Array.isArray(row.rewardRows) ? cleanRewardRows(row.rewardRows) : null,
    rewardCheckedAt: iso(row.rewardCheckedAt),
    rewardCheckedBy: await nameOf(row.rewardCheckedBy),
    notes: row.notes,
    checkedAt: iso(row.checkedAt),
    checkedBy: await nameOf(row.checkedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findRow(storeId: number, day: string): Promise<AuditStockOpname | null> {
  const [row] = await db
    .select()
    .from(auditStockOpnames)
    .where(and(eq(auditStockOpnames.storeId, storeId), eq(auditStockOpnames.soDate, day)))
    .limit(1);
  return row ?? null;
}

export async function getStockOpname(storeId: number, day: string): Promise<StockOpnameRecord | null> {
  const row = await findRow(storeId, day);
  return row ? toRecord(row) : null;
}

export async function getStockOpnameById(id: number): Promise<StockOpnameRecord | null> {
  const [row] = await db.select().from(auditStockOpnames).where(eq(auditStockOpnames.id, id)).limit(1);
  // IT-only test stores (DUMMY…) are hidden from Audit (IT sees them).
  return row && !(await isStoreHidden(row.storeId)) ? toRecord(row) : null;
}

// ─── Save ────────────────────────────────────────────────────────────────────

function checkDay(day: unknown): string | null {
  if (!isSoDate(day)) return 'Tanggal stock opname tidak valid.';
  if (day > jakartaTodayKey()) return 'Tanggal stock opname tidak boleh di masa depan.';
  return null;
}

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** A new row: shared visit number, the signatories used last (cash BA or SO), the store's defaults. */
async function ensureRow(
  ctx: StoreContext,
  day: string,
  actorId: string,
  holder: { id: string | null; name: string },
): Promise<AuditStockOpname> {
  const existing = await findRow(ctx.store.id, day);
  if (existing) return existing;

  const [doc, defaults, last, auditorName] = await Promise.all([
    newAuditDocNumber('so', ctx.store.id, ctx.store.storeNo, day),
    getSoStoreDefaults(ctx.store),
    db
      .select({
        signCity: auditStockOpnames.signCity,
        knownName: auditStockOpnames.knownName,
        knownTitle: auditStockOpnames.knownTitle,
        approvedName: auditStockOpnames.approvedName,
        approvedTitle: auditStockOpnames.approvedTitle,
        irName: auditStockOpnames.irName,
        irTitle: auditStockOpnames.irTitle,
      })
      .from(auditStockOpnames)
      .orderBy(desc(auditStockOpnames.updatedAt))
      .limit(1)
      .then((r) => r[0] ?? null),
    nameOf(actorId),
  ]);
  const now = new Date();

  await db
    .insert(auditStockOpnames)
    .values({
      storeId: ctx.store.id,
      soDate: day,
      docSeq: doc.seq,
      docNumber: doc.number,
      signCity: last?.signCity || DEFAULT_SIGN_CITY,
      signDate: day,
      storeTitle: defaults.storeTitle,
      suratCity: defaults.suratCity,
      suratBrand: defaults.suratBrand,
      suratLocation: defaults.suratLocation,
      holderUserId: holder.id,
      holderName: holder.name,
      holderCaption: defaults.holderCaption,
      holderTitle: DEFAULT_HOLDER_TITLE,
      auditorUserId: actorId,
      auditorName: auditorName ?? '',
      auditorCaption: DEFAULT_AUDITOR_CAPTION,
      knownName: last?.knownName || DEFAULT_KNOWN.name,
      knownTitle: last?.knownTitle || DEFAULT_KNOWN.title,
      approvedName: last?.approvedName || DEFAULT_APPROVED.name,
      approvedTitle: last?.approvedTitle || DEFAULT_APPROVED.title,
      irName: last?.irName || DEFAULT_IR.name,
      irTitle: last?.irTitle || DEFAULT_IR.title,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [auditStockOpnames.storeId, auditStockOpnames.soDate] });

  const row = await findRow(ctx.store.id, day);
  if (!row) throw new Error('Stock opname could not be created.');
  return row;
}

async function resolveHolder(ctx: StoreContext, holderUserId: unknown): Promise<{ id: string | null; name: string } | null> {
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

export interface SoSaveInput {
  storeId: number;
  date: string;
  holderUserId?: unknown;
  sohBc: unknown;
  scanQty: unknown;
  shoppingBagQty: unknown;
  transSalesQty: unknown;
  valuePlus: unknown;
  valueMinus: unknown;
  binsTotal: unknown;
  binsMatch: unknown;
  binsMismatch: unknown;
  findings: unknown;
  notes?: unknown;
}

/** 'bc' while both values are exactly what BC priced; 'manual' once the auditor typed something else. */
function valueSourceOf(plus: number | null, minus: number | null, snap: SoBcSnapshot | null): SoValueSource | null {
  if (plus == null && minus == null) return null;
  if (snap && snap.plusValue != null && snap.plusValue === (plus ?? 0) && snap.minusValue === (minus ?? 0)) return 'bc';
  return 'manual';
}

export async function saveStockOpname(actorId: string, input: SoSaveInput): Promise<Result<StockOpnameRecord>> {
  const dayProblem = checkDay(input.date);
  if (dayProblem) return fail(dayProblem);
  const ctx = await getStoreContext(input.storeId);
  if (!ctx) return fail('Toko tidak ditemukan.', 404);

  const binsTotal = toQty(input.binsTotal);
  const binsMatch = toQty(input.binsMatch);
  const binsMismatch = toQty(input.binsMismatch);
  if (binsTotal > 0 && binsMatch + binsMismatch > binsTotal) {
    return fail('Bin sesuai + tidak sesuai tidak boleh lebih dari total bin store.');
  }

  const chosen = await resolveHolder(ctx, input.holderUserId);
  const row = await ensureRow(ctx, input.date, actorId, chosen ?? defaultHolder(ctx));

  // What BC says now; a BC outage keeps the snapshot saved before.
  const fresh = await getSoBcSnapshot(ctx.store.storeNo, input.date);
  const snapshot = fresh.state === 'ok' || !row.bcSnapshot ? fresh : row.bcSnapshot;

  const valuePlus = toValue(input.valuePlus);
  const valueMinus = toValue(input.valueMinus);
  const now = new Date();

  await db
    .update(auditStockOpnames)
    .set({
      ...(chosen ? { holderUserId: chosen.id, holderName: chosen.name } : {}),
      sohBc: toQty(input.sohBc),
      scanQty: toQty(input.scanQty),
      shoppingBagQty: toQty(input.shoppingBagQty),
      transSalesQty: toQty(input.transSalesQty),
      valuePlus,
      valueMinus,
      valueSource: valueSourceOf(valuePlus, valueMinus, snapshot),
      binsTotal,
      binsMatch,
      binsMismatch,
      findings: cleanFindings(input.findings),
      notes: cleanText(input.notes, SO_NOTES_MAX),
      bcSnapshot: snapshot,
      checkedAt: now,
      checkedBy: actorId,
      updatedAt: now,
    })
    .where(eq(auditStockOpnames.id, row.id));

  const saved = await getStockOpnameById(row.id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}

// ─── Kop, Surat + tanda tangan ───────────────────────────────────────────────

const HEADER_FIELDS = [
  ['docNumber', DOC_NUMBER_MAX, 'Nomor dokumen'],
  ['signCity', SO_TEXT_MAX, 'Kota'],
  ['storeTitle', SO_TEXT_MAX, 'Nama toko'],
  ['suratCity', SO_TEXT_MAX, null],
  ['suratLocation', SO_TEXT_MAX, null],
  ['holderName', SO_TEXT_MAX, null],
  ['holderCaption', SO_TEXT_MAX, null],
  ['holderTitle', SO_TEXT_MAX, null],
  ['auditorName', SO_TEXT_MAX, null],
  ['auditorCaption', SO_TEXT_MAX, null],
  ['knownName', SO_TEXT_MAX, null],
  ['knownTitle', SO_TEXT_MAX, null],
  ['approvedName', SO_TEXT_MAX, null],
  ['approvedTitle', SO_TEXT_MAX, null],
  ['irName', SO_TEXT_MAX, null],
  ['irTitle', SO_TEXT_MAX, null],
] as const satisfies ReadonlyArray<readonly [keyof typeof auditStockOpnames.$inferInsert, number, string | null]>;

export async function updateSoHeader(id: number, input: Record<string, unknown>): Promise<Result<StockOpnameRecord>> {
  const [row] = await db.select({ id: auditStockOpnames.id, storeId: auditStockOpnames.storeId }).from(auditStockOpnames).where(eq(auditStockOpnames.id, id)).limit(1);
  if (!row || (await isStoreHidden(row.storeId))) return fail('Berita Acara SO tidak ditemukan.', 404);

  const patch: Partial<typeof auditStockOpnames.$inferInsert> = {};
  for (const [key, max, requiredLabel] of HEADER_FIELDS) {
    if (!(key in input)) continue;
    const value = typeof input[key] === 'string' ? (input[key] as string).trim().slice(0, max) : '';
    if (requiredLabel && !value) return fail(`${requiredLabel} wajib diisi.`);
    patch[key] = key === 'storeTitle' || key === 'suratLocation' ? value.toUpperCase() : value;
  }
  if ('signDate' in input) {
    if (!isSoDate(input.signDate)) return fail('Tanggal tanda tangan tidak valid.');
    patch.signDate = input.signDate;
  }
  if ('suratBrand' in input) {
    if (!isSoBrandKey(input.suratBrand)) return fail('Brand tidak valid.');
    patch.suratBrand = input.suratBrand;
  }
  if (Object.keys(patch).length === 0) return fail('Tidak ada yang diubah.');

  await db.update(auditStockOpnames).set({ ...patch, updatedAt: new Date() }).where(eq(auditStockOpnames.id, id));
  const saved = await getStockOpnameById(id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}

export async function deleteStockOpname(id: number): Promise<Result<{ id: number }>> {
  if (!(await getStockOpnameById(id))) return fail('Berita Acara SO tidak ditemukan.', 404);
  const deleted = await db.delete(auditStockOpnames).where(eq(auditStockOpnames.id, id)).returning({ id: auditStockOpnames.id });
  return deleted.length ? { success: true, data: { id } } : fail('Berita Acara SO tidak ditemukan.', 404);
}

/** Every Stock Opname of a month (by SO date), newest first. */
export async function listStockOpnames(month: string): Promise<StockOpnameListRow[]> {
  const rows = await db
    .select({ row: auditStockOpnames, storeNo: stores.storeNo, storeName: stores.name })
    .from(auditStockOpnames)
    .innerJoin(stores, eq(stores.id, auditStockOpnames.storeId))
    .where(and(
      gte(auditStockOpnames.soDate, `${month}-01`),
      lt(auditStockOpnames.soDate, `${addMonths(month, 1)}-01`),
      notHiddenStore(auditStockOpnames.storeId, (await getHiddenStores()).storeIds),
    ))
    .orderBy(desc(auditStockOpnames.soDate), stores.storeNo);

  return rows.map(({ row, storeNo, storeName }) => {
    const t = soTotals(row);
    return {
      id: row.id,
      storeId: row.storeId,
      storeNo,
      storeName,
      soDate: row.soDate,
      docNumber: row.docNumber,
      auditorName: row.auditorName,
      holderName: row.holderName,
      bcTotal: t.bcTotal,
      scanTotal: t.scanTotal,
      qtyDiff: t.qtyDiff,
      valueTotal: t.valueTotal,
      binsTotal: row.binsTotal,
      binsMatch: row.binsMatch,
      binsMismatch: row.binsMismatch,
      findings: Array.isArray(row.findings) ? row.findings.length : 0,
      rewardRows: Array.isArray(row.rewardRows) ? row.rewardRows.length : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}
