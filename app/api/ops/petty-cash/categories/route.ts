// app/api/ops/petty-cash/categories/route.ts
//
// GET  — every category (active + inactive) with how many requests used it.
// POST — create a category.
// PUT  — reorder: { ids: number[] } in the new display order.
//
// OPS HO / IT only (see _auth.ts). PATCH / DELETE live at ./[id].

import { NextRequest, NextResponse } from 'next/server';

import {
  createPettyCashCategory,
  listPettyCashCategoriesWithUsage,
  reorderPettyCashCategories,
} from '@/lib/db/utils/petty-cash-categories';
import { requireCategoryManager } from './_auth';

const forbidden = () =>
  NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

export async function GET() {
  if (!(await requireCategoryManager())) return forbidden();

  const categories = await listPettyCashCategoriesWithUsage();
  return NextResponse.json({
    success: true,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      defaultReason: c.defaultReason,
      requiresCustomReason: c.requiresCustomReason,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      usageCount: c.usageCount,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireCategoryManager())) return forbidden();

  const body = await req.json().catch(() => ({}));
  const result = await createPettyCashCategory(body);
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ success: true, category: result.data }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  if (!(await requireCategoryManager())) return forbidden();

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const result = await reorderPettyCashCategories(ids);
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
