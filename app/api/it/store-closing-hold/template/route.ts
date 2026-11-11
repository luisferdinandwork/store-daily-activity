// app/api/it/store-closing-hold/template/route.ts
//
// PUT    — save the default title + description of the On Hold issue.
// DELETE — back to the built-in text.
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { resetHoldTemplate, saveHoldTemplate } from '@/lib/db/utils/store-closing-hold';

export async function PUT(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  const result = await saveHoldTemplate(scope.userId, body);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true, template: result.data });
}

export async function DELETE() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const result = await resetHoldTemplate();
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true, template: result.data });
}
