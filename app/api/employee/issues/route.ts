// app/api/employee/issues/route.ts
//
// GET  — list the current employee's own reported issues (optional ?status=)
// POST — create a new issue, routed to a chosen role/department

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, users, userRoles } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

// ─── helpers ───────────────────────────────────────────────────────────────

function parseUrls(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  try { const p = JSON.parse(v as string); return Array.isArray(p) ? p : []; }
  catch { return []; }
}

type Row = {
  id: number; title: string; description: string;
  userId: string; storeId: number; status: string;
  attachmentUrls: string | null; reviewedBy: string | null; reviewedAt: Date | null;
  createdAt: Date; updatedAt: Date;
  assignedToRoleId: number; roleCode: string | null; roleLabel: string | null;
};

function serialize(r: Row) {
  return {
    id:          String(r.id),
    title:       r.title,
    description: r.description,
    userId:      r.userId,
    storeId:     String(r.storeId),
    status:      r.status,
    assignedTo:  r.roleCode ? { id: r.assignedToRoleId, code: r.roleCode, label: r.roleLabel } : null,
    reviewedBy:  r.reviewedBy,
    reviewedAt:  r.reviewedAt,
    attachmentUrls: parseUrls(r.attachmentUrls),
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
  };
}

const ISSUE_COLUMNS = {
  id: issues.id, title: issues.title, description: issues.description,
  userId: issues.userId, storeId: issues.storeId, status: issues.status,
  attachmentUrls: issues.attachmentUrls, reviewedBy: issues.reviewedBy, reviewedAt: issues.reviewedAt,
  createdAt: issues.createdAt, updatedAt: issues.updatedAt,
  assignedToRoleId: issues.assignedToRoleId, roleCode: userRoles.code, roleLabel: userRoles.label,
};

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id as string;
  const status = new URL(req.url).searchParams.get('status');

  const conditions = [eq(issues.userId, userId)];
  if (status) conditions.push(eq(issues.status, status));

  const rows = await db
    .select(ISSUE_COLUMNS)
    .from(issues)
    .leftJoin(userRoles, eq(issues.assignedToRoleId, userRoles.id))
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt));

  return NextResponse.json({ success: true, issues: rows.map(r => serialize(r as Row)) });
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id as string;
  const body = await req.json().catch(() => ({}));

  const title          = String(body.title ?? '').trim();
  const description    = String(body.description ?? '').trim();
  const attachmentUrls = Array.isArray(body.attachmentUrls) ? body.attachmentUrls : [];
  const assignedToRoleId = Number(body.assignedToRoleId);

  if (title.length < 3)        return NextResponse.json({ error: 'Title must be at least 3 characters.' }, { status: 400 });
  if (description.length < 10) return NextResponse.json({ error: 'Please describe the issue in more detail.' }, { status: 400 });
  if (!assignedToRoleId)       return NextResponse.json({ error: 'Please choose who to send this to.' }, { status: 400 });

  // Reporter's store comes from their profile — never trusted from the client.
  const [me] = await db
    .select({ id: users.id, homeStoreId: users.homeStoreId })
    .from(users)
    .where(eq(users.id, userId));

  if (!me?.homeStoreId) {
    return NextResponse.json({ error: 'Your account has no assigned store. Contact an admin.' }, { status: 400 });
  }

  // The destination role must be a real, active, issue-receiving role.
  const [role] = await db
    .select({ id: userRoles.id, code: userRoles.code, label: userRoles.label })
    .from(userRoles)
    .where(and(
      eq(userRoles.id, assignedToRoleId),
      eq(userRoles.canReceiveIssues, true),
      eq(userRoles.isActive, true),
    ));

  if (!role) return NextResponse.json({ error: 'Invalid destination.' }, { status: 400 });

  const [row] = await db
    .insert(issues)
    .values({
      title,
      description,
      userId: me.id,
      storeId: me.homeStoreId,
      assignedToRoleId: role.id,
      status: 'reported',
      attachmentUrls: JSON.stringify(attachmentUrls),
    })
    .returning();

  return NextResponse.json({
    success: true,
    issue: serialize({ ...(row as any), roleCode: role.code, roleLabel: role.label } as Row),
  });
}