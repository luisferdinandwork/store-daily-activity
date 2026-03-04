// app/api/employee/issues/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';

// ─── Validation ───────────────────────────────────────────────────────────────

const createIssueSchema = z.object({
  title:          z.string().min(3, 'Title must be at least 3 characters').max(120),
  description:    z.string().min(10, 'Please describe the issue in more detail').max(2000),
  // Accept any non-empty string — values are /public/issue-report/ paths,
  // not necessarily full URLs, so z.string().url() would incorrectly reject them.
  attachmentUrls: z.array(z.string().min(1)).max(5).optional(),
});

// ─── GET /api/employee/issues ─────────────────────────────────────────────────
// Returns all issues reported by the current employee (their store).

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; storeId?: string; role: string };

    if (!user.storeId) {
      return NextResponse.json({ error: 'No store assigned' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status'); // optional filter

    const conditions = [eq(issues.storeId, user.storeId)];

    // Employees only see their own reports unless they're ops/admin
    if (user.role === 'employee') {
      conditions.push(eq(issues.userId, user.id));
    }

    if (statusFilter && ['reported', 'in_review', 'resolved'].includes(statusFilter)) {
      conditions.push(eq(issues.status, statusFilter as any));
    }

    const rows = await db
      .select()
      .from(issues)
      .where(and(...conditions))
      .orderBy(desc(issues.createdAt));

    return NextResponse.json({ issues: rows });
  } catch (err) {
    console.error('[GET /api/employee/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST /api/employee/issues ────────────────────────────────────────────────
// Creates a new issue report for the current employee.

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; storeId?: string };

    if (!user.storeId) {
      return NextResponse.json({ error: 'No store assigned to your account' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = createIssueSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      );
    }

    const { title, description, attachmentUrls } = parsed.data;

    // Serialize attachment URLs as a JSON string for storage in the text column.
    // Schema: attachmentUrls text('attachment_urls') on the issues table.
    const attachmentUrlsJson = attachmentUrls && attachmentUrls.length > 0
      ? JSON.stringify(attachmentUrls)
      : null;

    const [newIssue] = await db
      .insert(issues)
      .values({
        title,
        description,
        userId:         user.id,
        storeId:        user.storeId,
        status:         'reported',
        attachmentUrls: attachmentUrlsJson,
      })
      .returning();

    // Parse stored JSON back to array for the response
    const parsedUrls = newIssue.attachmentUrls
      ? JSON.parse(newIssue.attachmentUrls) as string[]
      : [];

    return NextResponse.json(
      { issue: { ...newIssue, attachmentUrls: parsedUrls } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[POST /api/employee/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}