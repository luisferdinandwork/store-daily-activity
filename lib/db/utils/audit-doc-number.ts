// lib/db/utils/audit-doc-number.ts
//
// The Audit document number "71/IC-SO-FS020/INT/IX/26" is the number of a VISIT: in the audit team's workbook the
// Berita Acara Stock Opname (BA sheet) and the Berita Acara Pemeriksaan Kas (CO sheet) of the same store + day carry
// the same number. So:
//   - a new document first takes the number of the other document of the same store + day, if there is one;
//   - otherwise the next running number of the year, counted over BOTH tables.
// Each document keeps its own copy afterwards (editable on its own Berita Acara page).

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { auditCashChecks, auditStockOpnames } from '@/lib/db/schema';
import { buildDocNumber } from '@/lib/audit-cash-check';

export type AuditDocKind = 'cash' | 'so';

/** The number (+ running number) the other document of this visit already has, or null. */
async function siblingNumber(kind: AuditDocKind, storeId: number, day: string): Promise<{ seq: number; number: string } | null> {
  if (kind === 'cash') {
    const [row] = await db
      .select({ seq: auditStockOpnames.docSeq, number: auditStockOpnames.docNumber })
      .from(auditStockOpnames)
      .where(and(eq(auditStockOpnames.storeId, storeId), eq(auditStockOpnames.soDate, day)))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select({ seq: auditCashChecks.docSeq, number: auditCashChecks.docNumber })
    .from(auditCashChecks)
    .where(and(eq(auditCashChecks.storeId, storeId), eq(auditCashChecks.checkDate, day)))
    .limit(1);
  return row ?? null;
}

async function nextSeq(year: number): Promise<number> {
  const [[cash], [so]] = await Promise.all([
    db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${auditCashChecks.docSeq}), 0)` })
      .from(auditCashChecks)
      .where(sql`EXTRACT(YEAR FROM ${auditCashChecks.checkDate}) = ${year}`),
    db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${auditStockOpnames.docSeq}), 0)` })
      .from(auditStockOpnames)
      .where(sql`EXTRACT(YEAR FROM ${auditStockOpnames.soDate}) = ${year}`),
  ]);
  return Math.max(Number(cash?.maxSeq ?? 0), Number(so?.maxSeq ?? 0)) + 1;
}

/** The number a NEW document of `kind` for store + day starts with. */
export async function newAuditDocNumber(kind: AuditDocKind, storeId: number, storeNo: string, day: string): Promise<{ seq: number; number: string }> {
  const sibling = await siblingNumber(kind, storeId, day);
  if (sibling) return sibling;
  const seq = await nextSeq(Number(day.slice(0, 4)));
  return { seq, number: buildDocNumber(seq, storeNo, day) };
}
