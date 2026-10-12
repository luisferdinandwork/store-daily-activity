// components/idle-logout-watcher.tsx
'use client';

import { useIdleLogout } from '@/hooks/use-idle-logout';

/** Mounted app-wide; signs the user out after 15 minutes of no activity (2 hours for IT). */
export function IdleLogoutWatcher() {
  useIdleLogout();
  return null;
}
