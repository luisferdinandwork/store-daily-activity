// app/api/it/store-closing-hold/categories/route.ts
//
// POST — add a category.
// PUT  — reorder: { ids: [...] } = every category in the new order.
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { createHoldCategory, reorderHoldCategories } from '@/lib/db/utils/store-closing-hold';

export async function POST(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  const result = await createHoldCategory(body);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true, category: result.data }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  const result = await reorderHoldCategories((body as { ids?: unknown }).ids);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true });
}
