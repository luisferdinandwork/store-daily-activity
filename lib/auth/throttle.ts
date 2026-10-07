// lib/auth/throttle.ts
// ─────────────────────────────────────────────────────────────────────────────
// Generic in-memory sliding-window limiter for public, unauthenticated
// endpoints ("Lupa password"). Same trade-offs as the login throttle in
// lib/auth/rate-limit.ts: per-process state on globalThis, fine for the single
// PM2 fork instance; nginx limit_req still applies in front of it.
// ─────────────────────────────────────────────────────────────────────────────

const globalForThrottle = globalThis as unknown as { __throttle?: Map<string, number[]> };
const hits: Map<string, number[]> = (globalForThrottle.__throttle ??= new Map());

const MAX_KEYS = 20_000;

/**
 * Records one hit for `key` and says whether it is still within `limit` hits per
 * `windowMs`. A refused hit is not recorded, so a blocked caller recovers once
 * the window slides past its earlier hits.
 */
export function takeToken(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }

  if (hits.size > MAX_KEYS) hits.clear(); // hard bound; it's only a throttle
  list.push(now);
  hits.set(key, list);
  return true;
}
