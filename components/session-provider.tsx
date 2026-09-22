// components/session-provider.tsx
'use client';

import { SessionProvider as NextAuthSessionProvider, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { IdleLogoutWatcher } from '@/components/idle-logout-watcher';

interface SessionProviderProps {
  children: ReactNode;
}

/**
 * If the session disappears while a page is open — the JWT lapsed, or lib/auth.ts
 * revoked it because the account was deactivated — send the user to /login instead of
 * leaving a half-working page whose API calls all return 401.
 *
 * Only reacts to a definite 'unauthenticated' (never to 'loading'), and never on /login,
 * so it can't loop. A hard navigation is used so no stale client state survives.
 *
 * Debounced: a deliberate sign-out (sidebar button, or the 15-min idle logout in
 * hooks/use-idle-logout.ts) navigates to /login by itself within milliseconds and
 * unloads the page, cancelling this timer — so it never clobbers `?reason=timeout`.
 * It only fires when the page is still alive, i.e. the session was revoked in place.
 */
function SessionExpiryRedirect() {
  const { status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== 'unauthenticated' || pathname === '/login') return;
    const timer = window.setTimeout(
      // Deliberate hard navigation (see above): drops all client state of a dead session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      () => window.location.assign('/login'),
      1500,
    );
    return () => window.clearTimeout(timer);
  }, [status, pathname]);

  return null;
}

export function SessionProvider({ children }: SessionProviderProps) {
  return (
    // With the 15-minute session maxAge (see lib/auth.ts), an active client
    // must poll often enough to keep rolling the JWT forward. Poll every 5
    // minutes and on window focus; next-auth pauses the poll while the tab is
    // hidden, so a genuinely idle session still lapses after 15 minutes.
    <NextAuthSessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
      <IdleLogoutWatcher />
      <SessionExpiryRedirect />
      {children}
    </NextAuthSessionProvider>
  );
}
