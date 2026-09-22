// proxy.ts  (Next.js 16 — formerly `middleware.ts`)
// ─────────────────────────────────────────────────────────────────────────────
// First line of defence for every page and API request:
//
//   1. CSRF     — state-changing /api requests must be same-origin.
//   2. AuthN    — no valid session ⇒ 401 JSON (API) or redirect to /login (pages).
//   3. Panel RBAC — a role may only reach its own panel (rules: lib/auth/access.ts).
//   4. Headers  — CSP, nosniff, frame-ancestors, Referrer/Permissions-Policy, HSTS.
//
// THIS IS NOT THE ONLY GATE. The proxy only decodes the JWT cookie: it cannot see
// that a user was deactivated, and Next.js has had proxy/middleware bypass CVEs.
// The authoritative checks remain in each layout (`requirePanel`) and each route
// handler (`guardApi` / the *Scope helpers), which re-validate against the DB.
//
// Deliberately NOT done here: redirecting a signed-in user away from /login.
// A revoked-but-not-yet-expired cookie would bounce login → home → login forever.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import {
  apiRolesFor,
  homePathFor,
  isApiPath,
  isKnownRole,
  isPublicPath,
  pageRolesFor,
} from '@/lib/auth/access';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Security headers ─────────────────────────────────────────────────────────

const DEFAULT_NOS = ['https://nos.wjv-1.neo.id', 'https://nos.jkt-1.neo.id'];

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Object-storage origins the browser is allowed to fetch from (PDF manuals). */
function storageOrigins(): string[] {
  const set = new Set<string>(DEFAULT_NOS);
  for (const v of [
    process.env.NOS_ENDPOINT_PRIMARY,
    process.env.NOS_ENDPOINT_SECONDARY,
    process.env.NOS_PUBLIC_BASE_URL,
  ]) {
    const o = originOf(v);
    if (o) set.add(o);
  }
  return [...set];
}

function isHttpsDeployment(): boolean {
  return (process.env.NEXTAUTH_URL ?? '').startsWith('https://');
}

function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== 'production';
  const nos = storageOrigins().join(' ');

  const directives = [
    `default-src 'self'`,
    // Next.js App Router injects inline bootstrap scripts; a nonce-based policy would
    // force every page dynamic and is a larger change. Remote scripts, <object>, base
    // hijacking and framing are still blocked below.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    // Task/receipt photos come from NOS (and legacy OSS URLs); camera preview uses blob:.
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${nos}${dev ? ' ws: wss:' : ''}`,
    `media-src 'self' blob: data: ${nos}`,
    `frame-src 'self' blob: ${nos}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (!dev && isHttpsDeployment()) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function applySecurityHeaders(res: NextResponse, isApi: boolean): NextResponse {
  res.headers.set('Content-Security-Policy', contentSecurityPolicy());
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // Camera (task photos) and geolocation (attendance geofence) are core features.
  res.headers.set(
    'Permissions-Policy',
    'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()',
  );
  if (process.env.NODE_ENV === 'production' && isHttpsDeployment()) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  // Authenticated JSON must never be stored by a browser/proxy cache.
  if (isApi && !res.headers.has('Cache-Control')) {
    res.headers.set('Cache-Control', 'no-store');
  }
  return res;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function firstHeaderValue(value: string | null): string | null {
  return value ? value.split(',')[0].trim().toLowerCase() || null : null;
}

/** Public origin as the browser sees it (nginx terminates TLS, so req.url is http://). */
function publicOrigin(req: NextRequest): string {
  const proto = firstHeaderValue(req.headers.get('x-forwarded-proto')) ?? req.nextUrl.protocol.replace(':', '');
  const host =
    firstHeaderValue(req.headers.get('x-forwarded-host')) ??
    req.headers.get('host') ??
    req.nextUrl.host;
  return `${proto}://${host}`;
}

/**
 * Same-origin check for state-changing API calls. Browsers always send `Origin` on
 * cross-origin POST/PUT/PATCH/DELETE, so a mismatching (or opaque "null") Origin is
 * rejected. With no Origin at all the caller is a non-browser client (curl, cron) —
 * not a CSRF vector — unless the browser itself flags it `Sec-Fetch-Site: cross-site`.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');

  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  if (origin === 'null') return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const allowed = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v) allowed.add(v.split(',')[0].trim().toLowerCase());
  };
  add(req.headers.get('host'));
  add(req.headers.get('x-forwarded-host'));
  add(req.nextUrl.host);
  try {
    if (process.env.NEXTAUTH_URL) add(new URL(process.env.NEXTAUTH_URL).host);
  } catch {
    /* malformed NEXTAUTH_URL — ignore */
  }

  return allowed.has(originHost);
}

function json(status: 401 | 403, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const api = isApiPath(pathname);
  const done = (res: NextResponse) => applySecurityHeaders(res, api);

  // 1. CSRF — before anything else, and not for NextAuth (own CSRF token) / cron (bearer secret).
  if (api && UNSAFE_METHODS.has(req.method) && !isPublicPath(pathname) && !isSameOrigin(req)) {
    return done(json(403, 'Cross-origin request blocked.'));
  }

  if (isPublicPath(pathname)) return done(NextResponse.next());

  // 2. Authentication. getToken() can throw on a malformed cookie/header — treat that as "no session".
  let token: Awaited<ReturnType<typeof getToken>> = null;
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    token = null;
  }

  const role = token?.role;
  if (!token?.id || !isKnownRole(role)) {
    if (api) return done(json(401, 'Unauthorized'));
    return done(NextResponse.redirect(new URL('/login', publicOrigin(req))));
  }

  // 3. Panel-level RBAC (superset of every handler's own rule — see lib/auth/access.ts).
  const allowed = api ? apiRolesFor(pathname) : pageRolesFor(pathname);
  if (allowed && !allowed.includes(role)) {
    if (api) return done(json(403, 'Forbidden'));
    return done(
      NextResponse.redirect(new URL(homePathFor(role, token.employeeType), publicOrigin(req))),
    );
  }

  return done(NextResponse.next());
}

export const config = {
  // Everything except Next internals (incl. HMR websocket in dev) and static files in /public.
  matcher: [
    '/((?!_next/|__nextjs|favicon\\.ico|manifest\\.json|logo/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)',
  ],
};
