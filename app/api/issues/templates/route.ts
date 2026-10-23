// app/api/issues/templates/route.ts
//
// Active issue templates for the "Report an Issue" form (any signed-in user).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { listIssueTemplates } from '@/lib/db/utils/issue-templates';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const templates = await listIssueTemplates({ activeOnly: true });
  return NextResponse.json({
    success: true,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      title: t.title,
      description: t.description,
      assignedRoleIds: t.assignedRoleIds,
      isActive: t.isActive,
      sortOrder: t.sortOrder,
    })),
  });
}
