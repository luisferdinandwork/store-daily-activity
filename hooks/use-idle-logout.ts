// hooks/use-idle-logout.ts
'use client';

import { useEffect, useRef } from 'react';
import { signOut, useSession } from 'next-auth/react';

import { sessionIdleMs } from '@/lib/auth/session-policy';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
// Avoid clearing/resetting the timeout on every single mousemove/scroll event.
const RESET_THROTTLE_MS = 30 * 1000;

/** Signs the user out after IDLE_TIMEOUT_MS of no interaction with the page. */
export function useIdleLogout() {
  const { data: session, status } = useSession();
  // 15 minutes, 2 hours for IT (also while previewing another role).
  const IDLE_TIMEOUT_MS = sessionIdleMs(session?.user?.role, session?.user?.switchedFromRoleCode);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastResetRef = useRef(0);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const logout = () => {
      signOut({ callbackUrl: '/login?reason=timeout' });
    };

    const scheduleTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(logout, IDLE_TIMEOUT_MS);
      lastResetRef.current = Date.now();
    };

    const handleActivity = () => {
      if (Date.now() - lastResetRef.current < RESET_THROTTLE_MS) return;
      scheduleTimeout();
    };

    // setTimeout can be throttled/paused while the tab is hidden (e.g. laptop
    // sleep), so re-check elapsed idle time when the tab becomes visible again.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastResetRef.current >= IDLE_TIMEOUT_MS) {
        logout();
      }
    };

    scheduleTimeout();

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true }),
    );
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, handleActivity),
      );
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status, IDLE_TIMEOUT_MS]);
}
