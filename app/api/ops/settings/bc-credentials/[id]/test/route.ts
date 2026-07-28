// app/api/ops/settings/bc-credentials/[id]/test/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/settings/bc-credentials/:id/test
//
// Performs a lightweight call against the configured Business Central
// endpoint using the stored credentials, to confirm apiUrl/auth are valid.
// Does not change any data.
//
// Access: IT only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const [setting] = await db
    .select()
    .from(businessCentralSettings)
    .where(eq(businessCentralSettings.id, id))
    .limit(1);

  if (!setting) {
    return NextResponse.json({ success: false, error: 'Settings row not found.' }, { status: 404 });
  }

  let headers: HeadersInit;

  if (setting.authType === 'bearer') {
    if (!setting.bearerToken) {
      return NextResponse.json({ success: false, error: 'Bearer token is not set.' }, { status: 400 });
    }
    headers = { Accept: 'application/json', Authorization: `Bearer ${setting.bearerToken}` };
  } else {
    if (!setting.username || !setting.password) {
      return NextResponse.json({ success: false, error: 'Username/password are not set.' }, { status: 400 });
    }
    const basic = Buffer.from(`${setting.username}:${setting.password}`, 'utf8').toString('base64');
    headers = { Accept: 'application/json', Authorization: `Basic ${basic}` };
  }

  try {
    // Add a top=1 OData hint so we only fetch a tiny page, if supported.
    const url = new URL(setting.apiUrl);
    if (!url.searchParams.has('$top')) {
      url.searchParams.set('$top', '1');
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    const body = await response.text().catch(() => '');

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Business Central responded with ${response.status} ${response.statusText}`,
        detail: body.slice(0, 500),
      });
    }

    return NextResponse.json({
      success: true,
      status: response.status,
      message: 'Connection succeeded.',
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed.',
    });
  }
}