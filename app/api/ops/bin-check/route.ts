// app/api/ops/bin-check/route.ts — Ops "Progres Cek Bin": every store's monthly bin round (lib/bin-round-routes.ts).
//   GET ?month=YYYY-MM[&refresh=1]   OPS Area = own area only; OPS HO / IT = every active store.
import { handleOverview, opsRoundScope } from '@/lib/bin-round-routes';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleOverview(req, await opsRoundScope());
}
