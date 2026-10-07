// app/api/it/feature-switches/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET   — every switch from lib/feature-switches.ts with its current state.
// PATCH — { key, enabled } turns one switch on or off. IT-only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

import { resolveItScope } from '@/lib/auth/it-scope';
import { listFeatureSwitches, setFeatureSwitch } from '@/lib/db/utils/feature-switches';
import { FEATURE_SWITCHES, isFeatureSwitchKey } from '@/lib/feature-switches';

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  try {
    return NextResponse.json({ success: true, switches: await listFeatureSwitches() });
  } catch (err) {
    console.error('[GET /api/it/feature-switches]', err);
    return NextResponse.json({ success: false, error: 'Failed to load feature switches.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => null);
  const key = body?.key;
  const enabled = body?.enabled;

  if (!isFeatureSwitchKey(key)) {
    return NextResponse.json({ success: false, error: 'Unknown switch.' }, { status: 400 });
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ success: false, error: 'enabled must be true or false.' }, { status: 400 });
  }

  try {
    await setFeatureSwitch(key, enabled, scope.userId);
    console.info(`[feature-switches] ${key} → ${enabled ? 'on' : 'off'} by ${scope.userId}`);
    return NextResponse.json({
      success: true,
      switches: await listFeatureSwitches(),
      message: `${FEATURE_SWITCHES[key].title} is now ${enabled ? 'on' : 'off'}.`,
    });
  } catch (err) {
    console.error('[PATCH /api/it/feature-switches]', err);
    return NextResponse.json({ success: false, error: 'Failed to save the switch.' }, { status: 500 });
  }
}
