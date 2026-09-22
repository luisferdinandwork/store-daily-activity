// lib/auth/access.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for "which role may reach which path".
//
// Pure data + string helpers — no DB, no `next/*` imports — so it can be used by
// `proxy.ts`, the server layouts and (if ever needed) client code alike.
//
// The proxy uses these rules as a COARSE gate. They are deliberately a
// SUPERSET of what each route handler allows, because every handler still does
// its own (authoritative) check. Never tighten a rule here without checking
// that no legitimate cross-panel flow depends on it:
//
//   • IT is allowed on every panel — RoleSwitchBanner's "Viewing as IT" mode
//     lets an un-switched IT user browse /ops, /finance, /audit, /employee, /pic.
//   • /api/it/switch-role must stay reachable by ANY signed-in role: while an
//     IT user previews another role their JWT role is e.g. 'employee', and the
//     "Return to IT" button POSTs to that endpoint.
//   • OPS pages call /api/pic/schedule/* (schedule template download).
// ─────────────────────────────────────────────────────────────────────────────

export const APP_ROLES = ['employee', 'ops', 'finance', 'audit', 'it'] as const;
export type AppRoleCode = (typeof APP_ROLES)[number];

export function isKnownRole(role: unknown): role is AppRoleCode {
  return typeof role === 'string' && (APP_ROLES as readonly string[]).includes(role);
}

/** Where a signed-in user "lives". Mirrors app/page.tsx and the switch-role API. */
export function homePathFor(role: unknown, employeeType?: unknown): string {
  switch (role) {
    case 'employee':
      return employeeType === 'pic_1' || employeeType === 'pic_2' ? '/pic' : '/employee';
    case 'ops':
      return '/ops';
    case 'finance':
      return '/finance';
    case 'audit':
      return '/audit';
    case 'it':
      return '/it';
    default:
      return '/login';
  }
}

type Rule = { prefix: string; roles: readonly AppRoleCode[] };

/** Page (UI) panels. First match wins; prefixes are matched on path segments. */
const PAGE_RULES: readonly Rule[] = [
  { prefix: '/it', roles: ['it'] },
  { prefix: '/ops', roles: ['ops', 'it'] },
  { prefix: '/finance', roles: ['finance', 'it'] },
  { prefix: '/audit', roles: ['audit', 'it'] },
  // PIC users have role 'employee'; app/pic/layout.tsx additionally requires a PIC employee type.
  { prefix: '/pic', roles: ['employee', 'it'] },
  { prefix: '/employee', roles: ['employee', 'it'] },
];

/** API groups. First match wins, so more specific prefixes come first. */
const API_RULES: readonly Rule[] = [
  { prefix: '/api/it/switch-role', roles: APP_ROLES },
  { prefix: '/api/it', roles: ['it'] },
  { prefix: '/api/ops', roles: ['ops', 'it'] },
  { prefix: '/api/finance', roles: ['finance', 'it'] },
  { prefix: '/api/audit', roles: ['audit', 'it'] },
  { prefix: '/api/pic', roles: ['employee', 'ops', 'it'] },
  { prefix: '/api/employee', roles: ['employee', 'it'] },
  // /api/account, /api/upload, /api/issues, … → any signed-in role (handlers decide).
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Roles allowed on a UI path, or `null` when the path isn't a role-restricted panel. */
export function pageRolesFor(pathname: string): readonly AppRoleCode[] | null {
  return PAGE_RULES.find((r) => matchesPrefix(pathname, r.prefix))?.roles ?? null;
}

/** Roles allowed on an API path, or `null` when any signed-in role may call it. */
export function apiRolesFor(pathname: string): readonly AppRoleCode[] | null {
  return API_RULES.find((r) => matchesPrefix(pathname, r.prefix))?.roles ?? null;
}

/**
 * Paths reachable without a session:
 *   /login            — the sign-in page
 *   /api/auth/*       — NextAuth (has its own CSRF token handling)
 *   /api/cron/*       — machine callers; each handler verifies CRON_SECRET itself
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    matchesPrefix(pathname, '/api/auth') ||
    matchesPrefix(pathname, '/api/cron')
  );
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}
