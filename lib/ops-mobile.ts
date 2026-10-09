// lib/ops-mobile.ts
//
// Ops on a phone. Four pages are built for it and sit in the bottom tab bar —
// Dashboard, Issues, Petty Cash, Hasil Visit; every other Ops page still opens, under a
// banner that stays put: "Buka di desktop untuk pengalaman lebih baik".
// Shell: app/ops/OpsShell.tsx (components/ops/layout/OpsMobile*.tsx).

export const OPS_DESKTOP_HINT = 'Buka di desktop untuk pengalaman lebih baik';

/** Pages laid out for phones (prefix match on path segments, except the exact dashboard). */
const MOBILE_READY: { href: string; exact?: boolean }[] = [
  { href: '/ops', exact: true },
  { href: '/ops/issues' },
  { href: '/ops/petty-cash' },
  { href: '/ops/impact-visits/results' },
];

export function isOpsMobileReady(pathname: string): boolean {
  return MOBILE_READY.some(({ href, exact }) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`),
  );
}
