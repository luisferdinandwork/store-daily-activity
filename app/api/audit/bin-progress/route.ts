// app/api/audit/bin-progress/route.ts — Audit "Progres Cek Bin": every store's monthly bin round (lib/bin-round-routes.ts).
//   GET ?month=YYYY-MM[&refresh=1]   Audit + IT, every active store.
import { handleOverview, auditRoundScope } from '@/lib/bin-round-routes';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleOverview(req, await auditRoundScope());
}
