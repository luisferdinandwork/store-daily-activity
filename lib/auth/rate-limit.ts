// lib/auth/rate-limit.ts
// ─────────────────────────────────────────────────────────────────────────────
// In-memory login throttle for the credentials provider.
//
// Three independent counters over a sliding window; ANY of them tripping blocks
// the attempt:
//   • per NIK + IP   — the tight one: stops a guesser hammering one account
//   • per NIK        — looser, so one attacker's IP can't lock a victim out alone
//                      but a distributed guess against one account still stops
//   • per IP         — stops one host spraying many NIKs
//
// State lives on `globalThis` so it survives dev HMR. It is per-process: PM2
// runs a single fork instance (ecosystem.config.js), so that is sufficient. If
// you ever switch to cluster mode, move this to Redis/Postgres — and note that
// nginx's `limit_req` on the login endpoint (deploy/nginx) still applies either way.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;

const LIMITS = {
  nikAndIp: 5,
  nik: 20,
  ip: 60,
} as const;

type Bucket = { failures: number[] };

const globalForLimiter = globalThis as unknown as { __loginLimiter?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (globalForLimiter.__loginLimiter ??= new Map());

// Bound memory: never let a spray of random NIKs grow the map without limit.
const MAX_KEYS = 20_000;

function prune(bucket: Bucket, now: number) {
  const cutoff = now - WINDOW_MS;
  while (bucket.failures.length && bucket.failures[0] < cutoff) bucket.failures.shift();
}

function count(key: string, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  prune(bucket, now);
  if (!bucket.failures.length) {
    buckets.delete(key);
    return 0;
  }
  return bucket.failures.length;
}

function keys(nik: string, ip: string) {
  const n = nik.trim().toLowerCase();
  return {
    nikAndIp: `nik+ip:${n}|${ip}`,
    nik: `nik:${n}`,
    ip: `ip:${ip}`,
  };
}

/** True when this NIK/IP combination is currently locked out. */
export function isLoginBlocked(nik: string, ip: string): boolean {
  const now = Date.now();
  const k = keys(nik, ip);
  return (
    count(k.nikAndIp, now) >= LIMITS.nikAndIp ||
    count(k.nik, now) >= LIMITS.nik ||
    count(k.ip, now) >= LIMITS.ip
  );
}

export function recordLoginFailure(nik: string, ip: string): void {
  const now = Date.now();
  const k = keys(nik, ip);

  if (buckets.size > MAX_KEYS) {
    for (const [key, bucket] of buckets) {
      prune(bucket, now);
      if (!bucket.failures.length) buckets.delete(key);
    }
    // Still full after pruning → drop the oldest entries rather than grow.
    if (buckets.size > MAX_KEYS) {
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (buckets.size <= MAX_KEYS / 2) break;
      }
    }
  }

  for (const key of [k.nikAndIp, k.nik, k.ip]) {
    const bucket = buckets.get(key) ?? { failures: [] };
    bucket.failures.push(now);
    buckets.set(key, bucket);
  }
}

/** A successful sign-in clears the tight counters (the per-IP one keeps decaying on its own). */
export function clearLoginFailures(nik: string, ip: string): void {
  const k = keys(nik, ip);
  buckets.delete(k.nikAndIp);
  buckets.delete(k.nik);
}

/**
 * Best-effort client IP. Behind nginx, `X-Real-IP` is set from `$remote_addr`
 * (trustworthy — the app only listens on 127.0.0.1); the LAST `X-Forwarded-For`
 * hop is the one nginx appended, whereas earlier hops are client-controlled.
 */
export function clientIpFromHeaders(headers: Record<string, unknown> | undefined): string {
  const get = (name: string): string | undefined => {
    const v = headers?.[name];
    if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
    return typeof v === 'string' ? v : undefined;
  };

  const real = get('x-real-ip')?.trim();
  if (real) return real;

  const xff = get('x-forwarded-for');
  if (xff) {
    const last = xff.split(',').pop()?.trim();
    if (last) return last;
  }
  return 'unknown';
}
