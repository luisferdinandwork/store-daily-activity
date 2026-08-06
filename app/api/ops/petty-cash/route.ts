// app/api/ops/petty-cash/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { areas, stores, users } from '@/lib/db/schema/core';
import { pettyCashTransactions } from '@/lib/db/schema/petty-cash';

function currentYearMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;

  return `${year}-${month}`;
}

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export async function GET(req: NextRequest) {
  const scope = await resolveOpsScope();

  if (!scope.ok) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  }

  const month = req.nextUrl.searchParams.get('month') ?? currentYearMonth();

  if (!isValidMonth(month)) {
    return NextResponse.json(
      { success: false, error: 'Invalid month. Use YYYY-MM.' },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: pettyCashTransactions.id,
      amount: pettyCashTransactions.amount,
      description: pettyCashTransactions.description,
      status: pettyCashTransactions.status,
      imageUrl: pettyCashTransactions.imageUrl,
      approvedAt: pettyCashTransactions.approvedAt,
      rejectedAt: pettyCashTransactions.rejectedAt,
      rejectionReason: pettyCashTransactions.rejectionReason,
      createdAt: pettyCashTransactions.createdAt,

      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,

      submittedById: users.id,
      submittedByName: users.name,
    })
    .from(pettyCashTransactions)
    .innerJoin(stores, eq(stores.id, pettyCashTransactions.storeId))
    .innerJoin(areas, eq(areas.id, stores.areaId))
    .innerJoin(users, eq(users.id, pettyCashTransactions.userId))
    .where(
      and(
        eq(pettyCashTransactions.yearMonth, month),
        scope.scope === 'area'
          ? eq(stores.areaId, scope.areaId)
          : sql`TRUE`,
      ),
    )
    .orderBy(desc(pettyCashTransactions.createdAt));

  return NextResponse.json({
    success: true,
    month,
    scope: scope.scope,
    areaId: scope.areaId,
    data: rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      description: row.description,
      status: row.status,
      imageUrl: row.imageUrl,
      approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null,
      rejectedAt: row.rejectedAt ? new Date(row.rejectedAt).toISOString() : null,
      rejectionReason: row.rejectionReason,
      createdAt: new Date(row.createdAt).toISOString(),

      storeId: row.storeId,
      storeNo: row.storeNo,
      storeName: row.storeName,
      areaId: row.areaId,
      areaName: row.areaName,

      submittedById: row.submittedById,
      submittedByName: row.submittedByName,
    })),
  });
}