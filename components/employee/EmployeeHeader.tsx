'use client';
// components/employee/EmployeeHeader.tsx
//
// Layout-level top bar for every employee page that isn't a task detail page.
// Root tabs get the logo; everything else (profile, petty cash, transfer
// orders, unknown URLs…) gets back + title. Task detail pages
// (/employee/tasks/<type>/…) render the same EmployeeAppBar themselves via
// TaskHeader, because they add shift / status / autosave info to it.

import { usePathname } from 'next/navigation';
import EmployeeAppBar from './EmployeeAppBar';

const ROOT_TABS = new Set([
  '/employee',
  '/employee/tasks',
  '/employee/attendance',
  '/employee/schedule',
  '/employee/issues',
]);

const TITLES: Record<string, string> = {
  '/employee/profile': 'My Profile',
  '/employee/knowledge': 'Knowledge Base',
  '/employee/pettycash': 'Petty Cash',
  '/employee/announcements': 'Notifications',
  '/employee/item-transfers': 'Transfer Orders',
};

/** Task detail pages own their header (TaskHeader → EmployeeAppBar). */
export function isTaskDetailPath(pathname: string): boolean {
  return pathname.startsWith('/employee/tasks/');
}

export default function EmployeeHeader() {
  const pathname = usePathname();

  if (isTaskDetailPath(pathname)) return null;

  const title = TITLES[pathname];
  // Root tabs and URLs we have no title for (e.g. the not-found page) show
  // the branded root bar rather than a back button with an empty title.
  if (ROOT_TABS.has(pathname) || !title) return <EmployeeAppBar root />;

  return <EmployeeAppBar title={title} />;
}
