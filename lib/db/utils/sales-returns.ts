// lib/db/utils/sales-returns.ts
//
// Data behind Sales Return: an employee files a receipt (createSalesReturn), the
// staff app lists the store's latest (listStoreSalesReturns), and Ops / Finance
// browse them across stores (getSalesReturns).
//
// The period is a range of Jakarta calendar days. A return carries a real
// timestamp (createdAt, set at upload), so the range is converted to the UTC
// instants those Jakarta days start and end at — independent of the server's zone.

import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, salesReturns as sr, stores, users } from '@/lib/db/schema';
import { jakartaRangeBounds, todayJakarta } from '@/lib/finance/dates';
import {
  EMPLOYEE_SALES_RETURNS_LIMIT,
  parseImageUrls,
  type EmployeeSalesReturn,
  type SalesReturnQuery,
  type SalesReturnRow,
  type SalesReturnsPage,
} from '@/lib/sales-returns';

export const SALES_RETURN_PAGE_SIZE = 50;

// ─── Staff app ───────────────────────────────────────────────────────────────

export async function createSalesReturn(input: {
  storeId: number;
  userId: string;
  receiptNumber: string;
  imageUrls: string[];
}): Promise<{ id: number; createdAt: string }> {
  const createdAt = new Date();
  const [row] = await db
    .insert(sr)
    .values({
      storeId: input.storeId,
      userId: input.userId,
      receiptNumber: input.receiptNumber,
      imageUrls: JSON.stringify(input.imageUrls),
      createdAt,
    })
    .returning({ id: sr.id });

  return { id: row.id, createdAt: createdAt.toISOString() };
}

/** The store's latest returns, newest first — the staff app's list under the form. */
export async function listStoreSalesReturns(storeId: number, userId: string): Promise<EmployeeSalesReturn[]> {
  const rows = await db
    .select({
      id: sr.id,
      receiptNumber: sr.receiptNumber,
      imageUrls: sr.imageUrls,
      userId: sr.userId,
      uploadedByName: sql<string>`COALESCE(${users.name}, 'Unknown')`,
      createdAt: sr.createdAt,
    })
    .from(sr)
    .leftJoin(users, eq(users.id, sr.userId))
    .where(eq(sr.storeId, storeId))
    .orderBy(desc(sr.createdAt), desc(sr.id))
    .limit(EMPLOYEE_SALES_RETURNS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    imageUrls: parseImageUrls(r.imageUrls),
    uploadedByName: r.uploadedByName,
    mine: r.userId === userId,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

// ─── Ops / Finance list ──────────────────────────────────────────────────────

export interface SalesReturnFilters extends Omit<SalesReturnQuery, 'areaId'> {
  /** Ops Area users are pinned to their area; HO / IT may narrow to one or pass null. */
  areaId: number | null;
  /** Areas the caller may pick from; null = every area. Fills `areas` in the page. */
  pickableAreaId?: number | null;
}

/** `%` and `_` typed by a user are literals, not wildcards. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function filterCondition(f: SalesReturnFilters): SQL | undefined {
  const { start, end } = jakartaRangeBounds(f.from, f.to);
  const pattern = f.q ? `%${escapeLike(f.q)}%` : null;

  return and(
    gte(sr.createdAt, start),
    lt(sr.createdAt, end),
    f.storeId != null ? eq(sr.storeId, f.storeId) : undefined,
    f.areaId != null ? eq(stores.areaId, f.areaId) : undefined,
    pattern
      ? or(
          ilike(sr.receiptNumber, pattern),
          ilike(users.name, pattern),
          ilike(stores.name, pattern),
          ilike(stores.storeNo, pattern),
        )
      : undefined,
  );
}

export async function getSalesReturns(f: SalesReturnFilters): Promise<SalesReturnsPage> {
  const where = filterCondition(f);

  const today = todayJakarta();
  const todayBounds = jakartaRangeBounds(today, today);

  // Every query below joins the same two tables the filters reach into
  // (spelled out each time — Drizzle's select typing doesn't survive a helper).
  const [[agg], [todayRow], [top], storeOptions, areaOptions] = await Promise.all([
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        stores: sql<number>`COUNT(DISTINCT ${sr.storeId})::int`,
        employees: sql<number>`COUNT(DISTINCT ${sr.userId})::int`,
      })
      .from(sr)
      .innerJoin(stores, eq(stores.id, sr.storeId))
      .leftJoin(users, eq(users.id, sr.userId))
      .where(where),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(sr)
      .innerJoin(stores, eq(stores.id, sr.storeId))
      .leftJoin(users, eq(users.id, sr.userId))
      .where(and(where, gte(sr.createdAt, todayBounds.start), lt(sr.createdAt, todayBounds.end))),
    db
      .select({ storeNo: stores.storeNo, count: sql<number>`COUNT(*)::int` })
      .from(sr)
      .innerJoin(stores, eq(stores.id, sr.storeId))
      .leftJoin(users, eq(users.id, sr.userId))
      .where(where)
      .groupBy(stores.storeNo)
      .orderBy(sql`COUNT(*) DESC`, stores.storeNo)
      .limit(1),
    db
      .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name })
      .from(stores)
      .where(f.pickableAreaId != null ? eq(stores.areaId, f.pickableAreaId) : undefined)
      .orderBy(stores.storeNo),
    db
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(f.pickableAreaId != null ? eq(areas.id, f.pickableAreaId) : undefined)
      .orderBy(areas.name),
  ]);

  const matching = agg?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(matching / SALES_RETURN_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), totalPages);

  const rows: SalesReturnRow[] =
    matching === 0
      ? []
      : (
          await db
            .select({
              id: sr.id,
              storeId: sr.storeId,
              storeNo: stores.storeNo,
              storeName: stores.name,
              areaId: stores.areaId,
              receiptNumber: sr.receiptNumber,
              imageUrls: sr.imageUrls,
              uploadedBy: sql<string>`COALESCE(${users.name}, 'Unknown')`,
              createdAt: sr.createdAt,
            })
            .from(sr)
            .innerJoin(stores, eq(stores.id, sr.storeId))
            .leftJoin(users, eq(users.id, sr.userId))
            .where(where)
            .orderBy(desc(sr.createdAt), desc(sr.id))
            .limit(SALES_RETURN_PAGE_SIZE)
            .offset((page - 1) * SALES_RETURN_PAGE_SIZE)
        ).map((r) => ({
          id: r.id,
          storeId: r.storeId,
          storeNo: r.storeNo,
          storeName: r.storeName,
          areaName: areaOptions.find((a) => a.id === r.areaId)?.name ?? '',
          receiptNumber: r.receiptNumber,
          imageUrls: parseImageUrls(r.imageUrls),
          uploadedBy: r.uploadedBy,
          createdAt: new Date(r.createdAt).toISOString(),
        }));

  return {
    from: f.from,
    to: f.to,
    rows,
    summary: {
      count: matching,
      stores: agg?.stores ?? 0,
      employees: agg?.employees ?? 0,
      today: todayRow?.n ?? 0,
      topStore: top ? { storeNo: top.storeNo, count: top.count } : null,
    },
    stores: storeOptions,
    areas: areaOptions,
    matching,
    page,
    pageSize: SALES_RETURN_PAGE_SIZE,
    totalPages,
  };
}
