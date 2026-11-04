import { NextRequest, NextResponse } from 'next/server';
import { visitActor, visitResult } from '@/lib/store-visit/server';

type Context = { params: Promise<{ visitId: string }> };
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

/** One saved visit (store photo, geotag, what Ops wrote) for the Report's result preview. */
export async function GET(_req: NextRequest, ctx: Context) {
  const guard = await visitActor();
  if (!guard.ok) return guard.response;
  const { visitId } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitId)) return fail('Visit tidak valid.');
  try {
    const visit = await visitResult(visitId, guard.actor);
    if (!visit) return fail('Visit tidak ditemukan.', 404);
    return NextResponse.json({ success: true, visit });
  } catch (error) {
    console.error('Failed to load store visit result', error);
    return fail('Hasil visit gagal dimuat.', 500);
  }
}
