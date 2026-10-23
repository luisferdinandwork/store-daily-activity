// app/api/it/issue-templates/[id]/route.ts
//
// PATCH  — edit name / title / description / teams / active.
// DELETE — remove (issues already reported from it are unaffected).
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { deleteIssueTemplate, updateIssueTemplate } from '@/lib/db/utils/issue-templates';

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const result = await updateIssueTemplate(id, body);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true, template: result.data });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });

  const result = await deleteIssueTemplate(id);
  if (!result.success) return NextResponse.json(result, { status: 404 });
  return NextResponse.json({ success: true });
}
