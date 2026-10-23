// app/api/it/issue-templates/route.ts
//
// GET  — every issue template (active or not) + the teams an issue can go to.
// POST — create a template.
// IT-only.

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { getAssignableIssueRoles } from '@/lib/db/utils/issues';
import { createIssueTemplate, listIssueTemplates } from '@/lib/db/utils/issue-templates';

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const [templates, roles] = await Promise.all([listIssueTemplates(), getAssignableIssueRoles()]);
  return NextResponse.json({ success: true, templates, roles });
}

export async function POST(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => ({}));
  const result = await createIssueTemplate(body);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ success: true, template: result.data }, { status: 201 });
}
