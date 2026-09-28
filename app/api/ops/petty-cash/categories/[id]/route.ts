// app/api/ops/petty-cash/categories/[id]/route.ts
//
// PATCH  — edit name / default reason / "PIC writes own reason" / active.
// DELETE — remove; past requests keep their category name snapshot.
//
// IT only (see ../_auth.ts).

import { NextRequest, NextResponse } from 'next/server';

import {
  deletePettyCashCategory,
  updatePettyCashCategory,
} from '@/lib/db/utils/petty-cash-categories';
import { requireCategoryManager } from '../_auth';

type Ctx = { params: Promise<{ id: string }> };

const forbidden = () =>
  NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await requireCategoryManager())) return forbidden();

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const result = await updatePettyCashCategory(id, body);
  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ success: true, category: result.data });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  if (!(await requireCategoryManager())) return forbidden();

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });

  const result = await deletePettyCashCategory(id);
  if (!result.success) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
