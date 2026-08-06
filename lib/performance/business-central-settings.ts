// lib/performance/business-central-settings.ts
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';

export type ResolvedBusinessCentralSettings = {
  apiUrl: string;
  authType: 'basic' | 'bearer';
  username?: string;
  password?: string;
  bearerToken?: string;
  source: 'db' | 'env';
};

function cleanEnv(value: string | undefined) {
  return value?.trim() || '';
}

/**
 * Resolves the active BC credentials for one integration, keyed by
 * `business_central_settings.code`. Defaults to 'sales_entries' to preserve
 * the original caller's behavior.
 *
 * IMPORTANT: this used to ignore `code` entirely and just grab the single
 * latest active row — that broke the moment a second settings row existed
 * for a different integration (e.g. the item-transfer BC syncs). Every
 * caller MUST now pass its own code explicitly.
 *
 * The env-var fallback only applies to 'sales_entries' (the original
 * env var names are specific to it) — other codes with no matching DB row
 * simply return null, and callers should surface a clear "not configured"
 * error (see getBusinessCentralSalesEntries for the pattern).
 */
export async function getActiveBusinessCentralSettings(
  code: string = 'sales_entries',
): Promise<ResolvedBusinessCentralSettings | null> {
  const [dbSettings] = await db
    .select()
    .from(businessCentralSettings)
    .where(and(eq(businessCentralSettings.code, code), eq(businessCentralSettings.isActive, true)))
    .orderBy(desc(businessCentralSettings.id))
    .limit(1);

  if (dbSettings?.apiUrl) {
    const authType = dbSettings.authType === 'bearer' ? 'bearer' : 'basic';

    return {
      apiUrl: dbSettings.apiUrl,
      authType,
      username: dbSettings.username ?? undefined,
      password: dbSettings.password ?? undefined,
      bearerToken: dbSettings.bearerToken ?? undefined,
      source: 'db',
    };
  }

  if (code !== 'sales_entries') return null;

  const apiUrl = cleanEnv(process.env.BC_SALES_ENTRIES_URL);

  if (!apiUrl) return null;

  const bearerToken = cleanEnv(process.env.BC_API_BEARER_TOKEN);

  if (bearerToken) {
    return {
      apiUrl,
      authType: 'bearer',
      bearerToken,
      source: 'env',
    };
  }

  const username = cleanEnv(process.env.BC_API_USERNAME ?? process.env.BC_USERNAME);
  const password = cleanEnv(process.env.BC_API_PASSWORD ?? process.env.BC_PASSWORD);

  return {
    apiUrl,
    authType: 'basic',
    username,
    password,
    source: 'env',
  };
}
