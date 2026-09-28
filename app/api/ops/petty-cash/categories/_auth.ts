// app/api/ops/petty-cash/categories/_auth.ts
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { loadOpsActor } from '@/lib/auth/ops-actor';

/**
 * Petty cash categories apply to every store, so only head office manages
 * them: OPS HO or IT (same rule as the Knowledge Base). Null → 403.
 */
export async function requireCategoryManager() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return null;

  const actor = await loadOpsActor(userId);
  return actor?.isHO ? actor : null;
}
