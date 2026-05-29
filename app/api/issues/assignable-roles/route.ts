// app/api/issues/assignable-roles/route.ts
//
// Returns the roles/departments an employee may route an issue to.
// Driven entirely by user_roles.can_receive_issues, so adding a new
// destination (e.g. IT) is a data change, not a code change.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { userRoles } from '@/lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const roles = await db
    .select({
      id:          userRoles.id,
      code:        userRoles.code,
      label:       userRoles.label,
      description: userRoles.description,
    })
    .from(userRoles)
    .where(and(eq(userRoles.canReceiveIssues, true), eq(userRoles.isActive, true)))
    .orderBy(asc(userRoles.sortOrder));

  return NextResponse.json({ success: true, roles });
}