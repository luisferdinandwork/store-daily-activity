// app/api/ops/settings/bc-credentials/[id]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH  /api/ops/settings/bc-credentials/:id
//   → update fields on a business_central_settings row. Only provided fields
//     are changed; empty/omitted password/bearerToken leaves the stored
//     secret untouched.
//
// DELETE /api/ops/settings/bc-credentials/:id
//   → remove the settings row.
//
// Access: OPS HO only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';

type Params = { params: Promise<{ id: string }> };

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

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const { id: idRaw } = await params;
  const id = Number(idRaw);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(businessCentralSettings)
    .where(eq(businessCentralSettings.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ success: false, error: 'Settings row not found.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);

  const updates: Partial<typeof businessCentralSettings.$inferInsert> = {
    updatedBy: scope.userId,
    updatedAt: new Date(),
  };

  if (typeof body?.code === 'string' && body.code.trim()) updates.code = body.code.trim();
  if (typeof body?.name === 'string' && body.name.trim()) updates.name = body.name.trim();
  if (typeof body?.apiUrl === 'string' && body.apiUrl.trim()) updates.apiUrl = body.apiUrl.trim();

  if (body?.authType === 'basic' || body?.authType === 'bearer') {
    updates.authType = body.authType;
  }

  if (typeof body?.username === 'string') updates.username = body.username || null;

  // Only overwrite secrets if a non-empty value was provided.
  if (typeof body?.password === 'string' && body.password.length > 0) {
    updates.password = body.password;
  }

  if (typeof body?.bearerToken === 'string' && body.bearerToken.length > 0) {
    updates.bearerToken = body.bearerToken;
  }

  if (typeof body?.isActive === 'boolean') {
    updates.isActive = body.isActive;
  }

  // If activating this row, deactivate other rows with the same code so
  // getActiveBusinessCentralSettings() resolves to exactly one row.
  if (updates.isActive === true) {
    await db
      .update(businessCentralSettings)
      .set({ isActive: false })
      .where(eq(businessCentralSettings.code, updates.code ?? existing.code));
  }

  const [updated] = await db
    .update(businessCentralSettings)
    .set(updates)
    .where(eq(businessCentralSettings.id, id))
    .returning();

  return NextResponse.json({ success: true, setting: serialize(updated) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
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

  const { id: idRaw } = await params;
  const id = Number(idRaw);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  await db.delete(businessCentralSettings).where(eq(businessCentralSettings.id, id));

  return NextResponse.json({ success: true });
}