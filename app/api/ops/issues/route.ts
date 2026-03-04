// app/api/ops/issues/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, stores, users, areas } from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';

// ─── GET /api/ops/issues ──────────────────────────────────────────────────────
// Returns all issues from stores that belong to the ops user's area.
// Joins with store + reporter info for rich display.

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string; areaId?: string };

    // Only ops/admin can access this endpoint
    if (!['ops', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter  = searchParams.get('status');
    const storeFilter   = searchParams.get('storeId');

    // ── Resolve area scope ────────────────────────────────────────────────────
    // Admin sees everything; OPS sees only their area.
    let areaStoreIds: string[] = [];

    if (user.role === 'ops') {
      if (!user.areaId) {
        return NextResponse.json({ error: 'No area assigned to your account' }, { status: 400 });
      }

      // Fetch all stores in the ops user's area
      const areaStores = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.areaId, user.areaId));

      areaStoreIds = areaStores.map(s => s.id);

      if (areaStoreIds.length === 0) {
        return NextResponse.json({ issues: [], meta: { total: 0 } });
      }
    }

    // ── Build query ───────────────────────────────────────────────────────────
    // We do a manual join so we can return store + reporter names in one call.
    const issueRows = await db
      .select({
        // Issue fields
        id:             issues.id,
        title:          issues.title,
        description:    issues.description,
        status:         issues.status,
        attachmentUrls: issues.attachmentUrls,
        createdAt:      issues.createdAt,
        updatedAt:      issues.updatedAt,
        reviewedAt:     issues.reviewedAt,
        // Store info
        storeId:     issues.storeId,
        storeName:   stores.name,
        storeAreaId: stores.areaId,
        // Reporter info
        reporterId:    issues.userId,
        reporterName:  users.name,
        reporterEmail: users.email,
        // Reviewer
        reviewedBy:  issues.reviewedBy,
      })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .innerJoin(users,  eq(issues.userId,   users.id))
      .where(
        and(
          // Scope to area (skip for admin)
          user.role === 'ops' && areaStoreIds.length > 0
            ? inArray(issues.storeId, areaStoreIds)
            : undefined,

          // Optional status filter
          statusFilter && ['reported', 'in_review', 'resolved'].includes(statusFilter)
            ? eq(issues.status, statusFilter as any)
            : undefined,

          // Optional store filter
          storeFilter ? eq(issues.storeId, storeFilter) : undefined,
        ),
      )
      .orderBy(desc(issues.createdAt));

    // ── Enrich with area name ─────────────────────────────────────────────────
    // Collect unique area IDs and fetch their names
    const uniqueAreaIds = [...new Set(issueRows.map(r => r.storeAreaId).filter(Boolean))] as string[];

    const areaRows = uniqueAreaIds.length > 0
      ? await db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, uniqueAreaIds))
      : [];

    const areaMap = Object.fromEntries(areaRows.map(a => [a.id, a.name]));

    const enriched = issueRows.map(r => ({
      id:            r.id,
      title:         r.title,
      description:   r.description,
      status:        r.status,
      // Deserialize JSON string → string[] for the client
      attachmentUrls: r.attachmentUrls
        ? (typeof r.attachmentUrls === 'string'
            ? JSON.parse(r.attachmentUrls) as string[]
            : r.attachmentUrls as string[])
        : [] as string[],
      createdAt:     r.createdAt,
      updatedAt:     r.updatedAt,
      reviewedAt:    r.reviewedAt,
      reviewedBy:    r.reviewedBy,
      store: {
        id:       r.storeId,
        name:     r.storeName,
        areaId:   r.storeAreaId,
        areaName: r.storeAreaId ? (areaMap[r.storeAreaId] ?? 'Unknown Area') : null,
      },
      reporter: {
        id:    r.reporterId,
        name:  r.reporterName,
        email: r.reporterEmail,
      },
    }));

    // ── Summary counts ────────────────────────────────────────────────────────
    const meta = {
      total:     enriched.length,
      reported:  enriched.filter(i => i.status === 'reported').length,
      in_review: enriched.filter(i => i.status === 'in_review').length,
      resolved:  enriched.filter(i => i.status === 'resolved').length,
    };

    return NextResponse.json({ issues: enriched, meta });
  } catch (err) {
    console.error('[GET /api/ops/issues]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}