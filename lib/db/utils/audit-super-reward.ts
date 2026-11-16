// lib/db/utils/audit-super-reward.ts
//
// Audit "Super Reward" — the DB side (rules + shapes: lib/audit-super-reward.ts). The rows live on the Stock Opname
// record (`audit_stock_opnames.reward_rows`, a snapshot), filled on /audit/berita-acara-so/[id]/super-reward and
// printed as the Lampiran Regular Reward Stock Opname.
//
// The editor starts from the store's active staff (PIC 1 → PIC 2 → SA, like the sheet). A person who was on an
// EARLIER Super Reward of the same store gets that row's Tgl Masuk Toko Awal and SO dates carried over. On save the
// PRISM columns (NIK, name, PIC) of PRISM rows are read again from the users table, so they are never typed.

import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { auditStockOpnames, employeeTypes, users } from '@/lib/db/schema';
import { SO_TEXT_MAX, type StockOpnameRecord } from '@/lib/audit-stock-opname';
import {
  cleanRewardRows,
  newRewardRow,
  rewardTypeOf,
  sortRewardRows,
  type RewardPerson,
  type SoRewardRow,
} from '@/lib/audit-super-reward';
import { getStoreContext } from './audit-cash-check';
import { getStockOpnameById } from './audit-stock-opname';

type Result<T> = { success: true; data: T } | { success: false; error: string; status?: number };

const fail = (error: string, status = 400): { success: false; error: string; status: number } => ({ success: false, error, status });

export interface RewardStaff extends RewardPerson {
  userId: string;
}

export interface RewardEditor {
  so: StockOpnameRecord;
  /** The saved rows, or — before the first save — one suggested row per staff member. */
  rows: SoRewardRow[];
  /** The store's active staff now (for "Tambah karyawan"). */
  staff: RewardStaff[];
  /** A ready row for every staff member (carry-over applied), used when one is added back. */
  suggestions: Record<string, SoRewardRow>;
  /** userId → the earlier SO day a suggestion carried Tgl Masuk / SO dates from. */
  carried: Record<string, string>;
}

/** Earlier Super Rewards of the store, newest first. */
async function earlierRewards(storeId: number, soDate: string): Promise<Array<{ soDate: string; rows: SoRewardRow[] }>> {
  const rows = await db
    .select({ soDate: auditStockOpnames.soDate, rows: auditStockOpnames.rewardRows })
    .from(auditStockOpnames)
    .where(and(eq(auditStockOpnames.storeId, storeId), lt(auditStockOpnames.soDate, soDate), isNotNull(auditStockOpnames.rewardRows)))
    .orderBy(desc(auditStockOpnames.soDate))
    .limit(24);
  return rows.map((r) => ({ soDate: r.soDate, rows: cleanRewardRows(r.rows) }));
}

const sameNik = (a: string, b: string) => !!a && a.trim().toUpperCase() === b.trim().toUpperCase();

export async function getRewardEditor(id: number): Promise<RewardEditor | null> {
  const so = await getStockOpnameById(id);
  if (!so) return null;

  const [ctx, history] = await Promise.all([getStoreContext(so.storeId), earlierRewards(so.storeId, so.soDate)]);
  const staff: RewardStaff[] = (ctx?.staff ?? []).map((s) => ({ userId: s.id, nik: s.nik, name: s.name, type: rewardTypeOf(s.typeCode) }));

  const suggestions: Record<string, SoRewardRow> = {};
  const carried: Record<string, string> = {};
  for (const person of staff) {
    let previous: SoRewardRow | null = null;
    for (const h of history) {
      previous = h.rows.find((r) => r.userId === person.userId || sameNik(r.nik, person.nik)) ?? null;
      if (previous) {
        carried[person.userId] = h.soDate;
        break;
      }
    }
    suggestions[person.userId] = newRewardRow(person, so.soDate, previous);
  }

  const rows = so.reward ?? sortRewardRows(staff.map((s) => suggestions[s.userId]));
  return { so, rows, staff, suggestions, carried };
}

const SIGNER_FIELDS = [
  'auditorName',
  'auditorCaption',
  'approvedName',
  'approvedTitle',
  'irName',
  'irTitle',
  'knownName',
  'knownTitle',
] as const satisfies ReadonlyArray<keyof typeof auditStockOpnames.$inferInsert>;

export type RewardSigners = Record<(typeof SIGNER_FIELDS)[number], string>;

export async function saveReward(actorId: string, id: number, input: { rows: unknown; signers?: unknown }): Promise<Result<StockOpnameRecord>> {
  const [row] = await db.select({ id: auditStockOpnames.id }).from(auditStockOpnames).where(eq(auditStockOpnames.id, id)).limit(1);
  if (!row) return fail('Stock Opname tidak ditemukan.', 404);
  if (!Array.isArray(input.rows)) return fail('Daftar karyawan tidak valid.');

  const rows = cleanRewardRows(input.rows);

  // The PRISM columns of PRISM rows come from the users table, never from the form (a removed user keeps its snapshot).
  const ids = rows.map((r) => r.userId).filter((v): v is string => !!v);
  const people = ids.length
    ? await db
        .select({ id: users.id, nik: users.nik, name: users.name, typeCode: employeeTypes.code })
        .from(users)
        .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
        .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const fresh = rows.map((r) => {
    const p = r.userId ? byId.get(r.userId) : undefined;
    return p ? { ...r, nik: p.nik, name: p.name, type: rewardTypeOf(p.typeCode) } : r;
  });

  const signers: Partial<typeof auditStockOpnames.$inferInsert> = {};
  if (input.signers && typeof input.signers === 'object') {
    const raw = input.signers as Record<string, unknown>;
    for (const key of SIGNER_FIELDS) {
      if (typeof raw[key] === 'string') signers[key] = (raw[key] as string).trim().slice(0, SO_TEXT_MAX);
    }
  }

  const now = new Date();
  await db
    .update(auditStockOpnames)
    .set({ ...signers, rewardRows: sortRewardRows(fresh), rewardCheckedAt: now, rewardCheckedBy: actorId, updatedAt: now })
    .where(eq(auditStockOpnames.id, id));

  const saved = await getStockOpnameById(id);
  return saved ? { success: true, data: saved } : fail('Gagal menyimpan.', 500);
}
