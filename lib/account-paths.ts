// lib/account-paths.ts
//
// Single source of truth for "where does this role manage its own account"
// (profile picture + password). Used by the header avatar button and the
// 90-day password-expiry policy.

const ACCOUNT_PATH_BY_ROLE: Record<string, string> = {
  employee: '/employee/profile',
  ops: '/ops/settings',
  finance: '/finance/settings',
  audit: '/audit/settings',
  it: '/it/settings',
};

/**
 * @param role     user_roles.code
 * @param opts.pic true when the user is running inside the /pic shell — PIC
 *                 users share the `employee` role but /employee/profile is a
 *                 mobile-only route unreachable from the PIC desktop shell.
 */
export function accountPathForRole(
  role: string | null | undefined,
  opts?: { pic?: boolean },
): string {
  if (opts?.pic) return '/pic/settings';
  return (role && ACCOUNT_PATH_BY_ROLE[role]) || '/employee/profile';
}
