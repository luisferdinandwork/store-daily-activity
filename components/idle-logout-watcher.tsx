// components/idle-logout-watcher.tsx
'use client';

import { useIdleLogout } from '@/hooks/use-idle-logout';

/** Mounted app-wide; signs the user out after 6 hours of no activity. */
export function IdleLogoutWatcher() {
  useIdleLogout();
  return null;
}
