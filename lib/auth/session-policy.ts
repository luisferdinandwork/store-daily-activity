// lib/auth/session-policy.ts
//
// How long a session may sit idle before it lapses. Client-safe (no imports).
// Everyone gets 15 minutes; IT (super-admin, long configuration sessions) gets
// 2 hours — including while previewing another role, when the token's role is
// the previewed one and `switchedFromRoleCode` still says 'it'.

export const DEFAULT_IDLE_MS = 15 * 60 * 1000;
export const IT_IDLE_MS = 2 * 60 * 60 * 1000;

export function sessionIdleMs(role?: string | null, switchedFromRoleCode?: string | null): number {
  return role === 'it' || switchedFromRoleCode === 'it' ? IT_IDLE_MS : DEFAULT_IDLE_MS;
}
