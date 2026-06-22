// app/api/ops/settings/bc-credentials/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/ops/settings/bc-credentials
//   → list business_central_settings rows (HO OPS only). Passwords/tokens are
//     masked in the response.
//
// POST /api/ops/settings/bc-credentials
//   → create a new settings row.
//   Body: { code?, name?, apiUrl, authType, username?, password?, bearerToken?, isActive? }
//
// Access: OPS HO only — BC credentials affect every store's sales data.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';

function maskSecret(value: string | null): string | null {
  if (!value) return value;
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

function serialize(row: typeof businessCentralSettings.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    apiUrl: row.apiUrl,
    authType: row.authType,
    username: row.username,
    hasPassword: !!row.password,
    maskedPassword: maskSecret(row.password),
    hasBearerToken: !!row.bearerToken,
    maskedBearerToken: maskSecret(row.bearerToken),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  if (scope.scope !== 'all_areas') {
    return NextResponse.json(
      { success: false, error: 'Forbidden: only OPS HO can manage Business Central credentials.' },
      { status: 403 },
    );
  }

  const rows = await db
    .select()
    .from(businessCentralSettings)
    .orderBy(desc(businessCentralSettings.isActive), desc(businessCentralSettings.id));

  return NextResponse.json({ success: true, settings: rows.map(serialize) });
}

export async function POST(req: NextRequest) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  if (scope.scope !== 'all_areas') {
    return NextResponse.json(
      { success: false, error: 'Forbidden: only OPS HO can manage Business Central credentials.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);

  const apiUrl = (body?.apiUrl as string | undefined)?.trim();
  if (!apiUrl) {
    return NextResponse.json({ success: false, error: 'apiUrl is required.' }, { status: 400 });
  }

  const authType = body?.authType === 'bearer' ? 'bearer' : 'basic';

  if (authType === 'basic' && (!body?.username || !body?.password)) {
    return NextResponse.json(
      { success: false, error: 'username and password are required for Basic Auth.' },
      { status: 400 },
    );
  }

  if (authType === 'bearer' && !body?.bearerToken) {
    return NextResponse.json(
      { success: false, error: 'bearerToken is required for Bearer Auth.' },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(businessCentralSettings)
    .values({
      code: (body?.code as string | undefined)?.trim() || 'sales_entries',
      name: (body?.name as string | undefined)?.trim() || 'Business Central Sales Entries',
      apiUrl,
      authType,
      username: authType === 'basic' ? (body.username as string) : null,
      password: authType === 'basic' ? (body.password as string) : null,
      bearerToken: authType === 'bearer' ? (body.bearerToken as string) : null,
      isActive: typeof body?.isActive === 'boolean' ? body.isActive : true,
      createdBy: scope.userId,
      updatedBy: scope.userId,
    })
    .returning();

  return NextResponse.json({ success: true, setting: serialize(created) });
}