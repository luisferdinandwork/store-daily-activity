// app/api/audit/bin-progress/[storeId]/route.ts — one store's month of the bin round (lib/bin-round-routes.ts).
//   GET  ?month=YYYY-MM[&refresh=1]   the store's bins: right / wrong / not checked + today's list
//   POST                              read the store's bin list from BC again (in the background)
import { handleDetail, handleSync, auditRoundScope } from '@/lib/bin-round-routes';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ storeId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handleDetail(req, await auditRoundScope(), (await ctx.params).storeId);
}

export async function POST(_req: Request, ctx: Ctx) {
  return handleSync(await auditRoundScope(), (await ctx.params).storeId);
}
