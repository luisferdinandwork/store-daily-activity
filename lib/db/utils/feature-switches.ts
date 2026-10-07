// lib/db/utils/feature-switches.ts
//
// Read / flip the IT feature switches declared in lib/feature-switches.ts.
// isFeatureEnabled() fails closed: if the row can't be read (e.g. the table
// isn't migrated yet) the switch is at its default.

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { featureSwitches, users } from '@/lib/db/schema';
import {
  FEATURE_SWITCHES,
  FEATURE_SWITCH_KEYS,
  type FeatureSwitchKey,
  type FeatureSwitchState,
} from '@/lib/feature-switches';

export async function isFeatureEnabled(key: FeatureSwitchKey): Promise<boolean> {
  try {
    const [row] = await db
      .select({ enabled: featureSwitches.enabled })
      .from(featureSwitches)
      .where(eq(featureSwitches.key, key))
      .limit(1);
    return row ? row.enabled : FEATURE_SWITCHES[key].defaultEnabled;
  } catch (err) {
    console.error(`[feature-switches] reading ${key} failed — using its default`, err);
    return FEATURE_SWITCHES[key].defaultEnabled;
  }
}

export async function listFeatureSwitches(): Promise<FeatureSwitchState[]> {
  const rows = await db
    .select({
      key: featureSwitches.key,
      enabled: featureSwitches.enabled,
      updatedAt: featureSwitches.updatedAt,
      updatedByName: users.name,
    })
    .from(featureSwitches)
    .leftJoin(users, eq(users.id, featureSwitches.updatedBy));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return FEATURE_SWITCH_KEYS.map((key) => {
    const def = FEATURE_SWITCHES[key];
    const row = byKey.get(key);
    return {
      key,
      title: def.title,
      description: def.description,
      appliesTo: def.appliesTo,
      enabled: row ? row.enabled : def.defaultEnabled,
      defaultEnabled: def.defaultEnabled,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedByName: row?.updatedByName ?? null,
    };
  });
}

export async function setFeatureSwitch(
  key: FeatureSwitchKey,
  enabled: boolean,
  actorId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(featureSwitches)
    .values({ key, enabled, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({
      target: featureSwitches.key,
      set: { enabled, updatedBy: actorId, updatedAt: now },
    });
}
