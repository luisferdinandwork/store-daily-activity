'use client';
// components/employee/EmployeeHeader.tsx
//
// Single top app-bar shared by every top-level employee page — rendered once
// from app/employee/layout.tsx instead of each page pasting its own
// bg-primary hero logo or its own neutral "back + title" sticky bar. Carries
// brand (logo on root tabs), navigation (back button on drill-in pages) and
// the notification bell, consistently, everywhere.
//
// Multi-step task-taking flows (/employee/tasks/<type>/<id>, serah-terima,
// etc.) keep their own contextual step header — this bar renders nothing
// there, see VISIBLE_PATHS below.

import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import EmployeeLogoMark from './EmployeeLogoMark';
import EmployeeNotificationBell from './EmployeeNotificationBell';
import EmployeeItemTransfersBadge from './EmployeeItemTransfersBadge';

const ROOT_TABS = new Set([
  '/employee',
  '/employee/tasks',
  '/employee/attendance',
  '/employee/schedule',
  '/employee/issues',
]);

const TITLES: Record<string, string> = {
  '/employee/profile': 'My Profile',
  '/employee/settings': 'Settings',
  '/employee/knowledge': 'Knowledge Base',
  '/employee/pettycash': 'Petty Cash',
  '/employee/announcements': 'Notifications',
  '/employee/item-transfers': 'Item Transfers',
};

const VISIBLE_PATHS = new Set<string>([...ROOT_TABS, ...Object.keys(TITLES)]);

export default function EmployeeHeader() {
  const pathname = usePathname();
  const router = useRouter();

  if (!VISIBLE_PATHS.has(pathname)) return null;

  const isRootTab = ROOT_TABS.has(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 bg-primary px-2">
      {isRootTab ? (
        <EmployeeLogoMark variant="white" className="ml-2 w-24" />
      ) : (
        <>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/10 active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="flex-1 truncate text-sm font-bold text-primary-foreground">
            {TITLES[pathname]}
          </p>
        </>
      )}

      {isRootTab && <div className="flex-1" />}

      {isRootTab && <EmployeeItemTransfersBadge />}
      <EmployeeNotificationBell />
    </header>
  );
}
