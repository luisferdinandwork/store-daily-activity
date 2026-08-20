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
    <NextAuthSessionProvider>
      <IdleLogoutWatcher />
      {children}
    </NextAuthSessionProvider>
  );
}