// lib/auth/cron.ts
// ─────────────────────────────────────────────────────────────────────────────
// Authorisation for /api/cron/* endpoints (system crontab or Vercel Cron, both
// send `Authorization: Bearer <CRON_SECRET>`).
//
// FAIL CLOSED: the previous per-route check was
//     if (process.env.CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) → 401
// which silently made every job (auto-absent, auto-checkout, image cleanup, …)
// PUBLIC whenever CRON_SECRET happened to be unset. Now a missing secret is an
// error in production, and only `next dev` may run them without one (so the
// endpoints stay hittable from a browser locally).
// ─────────────────────────────────────────────────────────────────────────────

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Returns `null` when the request is authorised, otherwise the response to send.
 *
 *   const denied = verifyCronRequest(req);
 *   if (denied) return denied;
 */
export function verifyCronRequest(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null; // local dev convenience only
    console.error('[cron] CRON_SECRET is not set — refusing to run cron endpoints in production.');
    return NextResponse.json(
      { success: false, error: 'Cron is not configured.' },
      { status: 503 },
    );
  }

  const header = req.headers.get('authorization') ?? '';
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
