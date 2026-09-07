// components/session-provider.tsx
'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { IdleLogoutWatcher } from '@/components/idle-logout-watcher';

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  return (
    // With the 15-minute session maxAge (see lib/auth.ts), an active client
    // must poll often enough to keep rolling the JWT forward. Poll every 5
    // minutes and on window focus; next-auth pauses the poll while the tab is
    // hidden, so a genuinely idle session still lapses after 15 minutes.
    <NextAuthSessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
      <IdleLogoutWatcher />
      {children}
    </NextAuthSessionProvider>
  );
}