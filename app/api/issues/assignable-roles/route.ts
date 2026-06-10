// app/api/issues/assignable-roles/route.ts
//
// Returns roles/departments an employee may route an issue to.
// Driven by user_roles.can_receive_issues.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAssignableIssueRoles } from '@/lib/db/utils/issues';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const roles = await getAssignableIssueRoles();
  return NextResponse.json({ success: true, roles });
}
