// lib/performance/business-central-settings.ts
import { desc, eq } from 'drizzle-orm';

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

export async function getActiveBusinessCentralSettings(): Promise<ResolvedBusinessCentralSettings | null> {
  const [dbSettings] = await db
    .select()
    .from(businessCentralSettings)
    .where(eq(businessCentralSettings.isActive, true))
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
