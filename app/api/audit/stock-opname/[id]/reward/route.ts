// app/api/audit/stock-opname/[id]/reward/route.ts
//
// The Super Reward of one Stock Opname (lib/db/utils/audit-super-reward.ts).
//   GET → { so, rows (saved, or suggested from the store's staff), staff, suggestions, carried }
//   PUT { rows: SoRewardRow[], signers?: { auditorName, auditorCaption, approvedName, approvedTitle, irName, irTitle,
//         knownName, knownTitle } } → saves; { so }
//
// Audit + IT only (proxy rule on /api/audit + resolveAuditScope).

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { getRewardEditor, saveReward } from '@/lib/db/utils/audit-super-reward';

type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  try {
    const editor = await getRewardEditor(id);
    if (!editor) return NextResponse.json({ success: false, error: 'Stock Opname tidak ditemukan.' }, { status: 404 });
    return NextResponse.json({ success: true, ...editor });
  } catch (error) {
    console.error('[audit/stock-opname/id/reward] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat Super Reward.' }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  const id = await idOf(ctx);
  if (!id) return NextResponse.json({ success: false, error: 'ID tidak valid.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Body tidak valid.' }, { status: 400 });
  }

  try {
    const result = await saveReward(scope.userId, id, { rows: body.rows, signers: body.signers });
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({ success: true, so: result.data });
  } catch (error) {
    console.error('[audit/stock-opname/id/reward] PUT failed', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan Super Reward.' }, { status: 500 });
  }
}
